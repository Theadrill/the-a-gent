const fs = require('fs');
const path = require('path');

const logStream = fs.createWriteStream(path.resolve(__dirname, 'log.txt'), { flags: 'w' });
const originalLog = console.log;
const originalError = console.error;
console.log = (...args) => { logStream.write(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 4) : String(a)).join(' ') + '\n'); originalLog(...args); };
console.error = (...args) => { logStream.write('[ERRO] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 4) : String(a)).join(' ') + '\n'); originalError(...args); };

const { salvarMensagem, buscarUltimasMensagens } = require('./src/memory/memoryManager');
const { buildPrompt } = require('./src/core/promptBuilder');
const { llmClient } = require('./src/core/llmClient');
const { parseAndValidate } = require('./src/core/jsonExtractor');
const { executeToolCall } = require('./src/tools/toolManager');
const { formatToolResult } = require('./src/utils/toolFormatter');
const dbAdapter = require('./src/memory/dbAdapter');
const config = require('./config.json');

if (!salvarMensagem || !buscarUltimasMensagens || !llmClient || !parseAndValidate || !buildPrompt) {
  console.error('[INDEX][CRITICO] Modulos da Fase 1 incompletos ou invalidos.');
  process.exit(1);
}

const MAX_BUFFER = (() => {
  const v = Number(config?.memoria?.max_buffer) || 0;
  return Number.isFinite(v) && v > 0 ? v : 20;
})();

const VERBOSE = config.verbose === true;
const REQUEST_TIMEOUT_MS = (config.max_timeout_seconds || 180) * 1000;
let stopRequested = false;

console.log('[BOOT] The A-gent iniciando...');
console.log('[BOOT] Provedor:', config.api.provider, '/ Modelo:', config.api.model);
console.log('[BOOT] Buffer de memoria:', MAX_BUFFER, 'mensagens');
console.log('[BOOT] Timeout por requisicao:', REQUEST_TIMEOUT_MS / 1000, 's');
console.log('[BOOT] Verbose:', VERBOSE);
console.log('[BOOT] Conectando ao WhatsApp...');

async function processToolLoop(sock, sender, msg) {
  const startTime = Date.now();

  while (Date.now() - startTime < REQUEST_TIMEOUT_MS) {
    if (stopRequested) {
      stopRequested = false;
      return;
    }

    const { getActiveSocket } = require('./src/plugins/whatsapp/connection');
    sock = (typeof getActiveSocket === 'function' ? getActiveSocket() : null) || sock;

    const historico = await buscarUltimasMensagens(MAX_BUFFER);
    const promptPayload = await buildPrompt('[SISTEMA] Ação concluída. Prossiga com o objetivo do usuário ou apresente os resultados finais.', historico);
    const respostaBruta = await llmClient(promptPayload, sender);

    if (typeof respostaBruta !== 'string') {
      throw new Error('Resposta do LLM invalida no loop');
    }

    const parsed = parseAndValidate(respostaBruta);
    if (!parsed || !parsed.data) {
      throw new Error('Resposta do LLM nao contem dados validos');
    }

    const data = parsed.data;

    const isFinal = data.final === true;
    const toolCall = data.tool_call || (data.acao && data.acao !== null
      ? { tool: data.acao, params: data.parametros }
      : null);

    if (isFinal || !toolCall) {
      if (data.resposta) {
        await salvarMensagem('assistant', data.resposta);
        if (sock && typeof sock.sendMessage === 'function') {
          await sock.sendMessage(sender, { text: data.resposta });
        }
      }
      return;
    }

    if (VERBOSE) {
      const statusMsg = toolCall.tool === 'pesquisarWeb'
        ? `🔍 Pesquisando na internet: "${toolCall.params?.query || '...'}"...`
        : toolCall.tool === 'buscarPagina'
        ? `📄 Acessando pagina: ${toolCall.params?.url || '...'}...`
        : `⚙️ Executando ${toolCall.tool}...`;
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: statusMsg }).catch(() => {});
      }
    }

    const assistantMemory = (data.resposta ? data.resposta + '\n' : '') + JSON.stringify({ acao: toolCall.tool, parametros: toolCall.params || {} });
    await salvarMensagem('assistant', assistantMemory);

    console.log('[LOOP] Chamando ferramenta:', toolCall.tool);
    const result = await executeToolCall(sender, { tool: toolCall.tool, params: toolCall.params || {}, skipConfirmation: true });
    console.log('[LOOP] Resultado da ferramenta: success=' + result.success + ' error=' + (result.error?.message || 'none'));

    if (result.metadata && result.metadata.immediateReply) {
      const reply = result.success
        ? `✅ ${result.data?.mensagem || 'Operacao concluida.'}`
        : `❌ ${result.error?.message || 'Erro desconhecido.'}`;
      await salvarMensagem('assistant', reply);
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: reply });
      }
      return;
    }

    const toolResultMsg = formatToolResult(toolCall.tool, result);
    await salvarMensagem('system', toolResultMsg);

    if (!result.success) {
      console.log('[LOOP] Ferramenta falhou, encerrando loop');
      const failReply = result.error?.message || 'Erro desconhecido.';
      await salvarMensagem('assistant', failReply);
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: `❌ ${failReply}` });
      }
      return;
    }

    if (VERBOSE) {
      const thinkingMsg = toolCall.tool === 'pesquisarWeb' || toolCall.tool === 'buscarPagina'
        ? '🧠 Gerando sua resposta...'
        : null;
      if (thinkingMsg && sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: thinkingMsg }).catch(() => {});
      }
    }

    console.log('[LOOP] Ferramenta executada com sucesso, continuando loop');
    continue;
  }

  console.log('[LOOP] Tempo limite excedido (' + (REQUEST_TIMEOUT_MS / 1000) + 's)');
  if (sock && typeof sock.sendMessage === 'function') {
    await sock.sendMessage(sender, { text: '⏱️ O tempo limite foi atingido. Se precisar de mais detalhes, peca para eu continuar de onde parei.' });
  }
}

async function processTextMessage(sock, sender, text, msg) {
  try {
    const { getActiveSocket } = require('./src/plugins/whatsapp/connection');
    sock = (typeof getActiveSocket === 'function' ? getActiveSocket() : null) || sock;

    console.log('[PROCESS_TEXT] Mensagem recebida de', sender, ':', text ? text.slice(0, 50) : '(midia)');

    if (text && /^pare$/i.test(text.trim())) {
      stopRequested = true;
      console.log('[PROCESS_TEXT] Parada solicitada pelo usuario');
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: '🛑 Processo interrompido com sucesso, aguardando novas mensagens.' });
      }
      return;
    }

    if (msg?.key) {
      if (typeof sock.readMessages === 'function') {
        await sock.readMessages([msg.key]);
      } else {
        console.warn('[WHATSAPP] sock.readMessages nao e uma funcao');
      }
    }
    if (typeof sock.sendPresenceUpdate === 'function') {
      await sock.sendPresenceUpdate('composing', sender);
    } else {
      console.warn('[WHATSAPP] sock.sendPresenceUpdate nao e uma funcao');
    }

    const pendingAction = await dbAdapter.buscarPendingAction(sender);
    if (pendingAction && /^(sim|s|yes|confirmar)$/i.test(text.trim())) {
      console.log('[PROCESS_TEXT] Confirmacao recebida para:', pendingAction.tool);
      const result = await executeToolCall(sender, { tool: pendingAction.tool, params: pendingAction.params, skipConfirmation: true });
      await dbAdapter.removerPendingAction(pendingAction.id);

      const formatted = formatToolResult(pendingAction.tool, result);
      await salvarMensagem('system', formatted);

      return await processToolLoop(sock, sender, msg);
    }

    if (pendingAction && /^(nao|n|no|cancelar)$/i.test(text.trim())) {
      await dbAdapter.removerPendingAction(pendingAction.id);
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: 'Acao cancelada.' });
      }
      return;
    }

    const safeText = text.length > 10000 ? text.slice(0, 10000) + '\n\n[TEXTO TRUNCADO]' : text;
    await salvarMensagem('user', safeText);

    const promptPayload = await buildPrompt(safeText);
    const respostaBruta = await llmClient(promptPayload, sender);

    if (typeof respostaBruta !== 'string') throw new Error('Resposta do LLM invalida');
    console.log('[PROCESS_TEXT] Resposta bruta do LLM:', respostaBruta.slice(0, 300));
    const parsed = parseAndValidate(respostaBruta);
    console.log('[PROCESS_TEXT] JSON parseado:', JSON.stringify(parsed.data).slice(0, 300));

    if (!parsed || !parsed.data) {
      throw new Error('Resposta do LLM nao contem dados validos');
    }

    const data = parsed.data;
    const toolCall = data.tool_call || (data.acao && data.acao !== null
      ? { tool: data.acao, params: data.parametros }
      : null);

    if (toolCall) {
      console.log('[PROCESS_TEXT] Acao detectada:', toolCall.tool);

      if (VERBOSE) {
        const statusMsg = toolCall.tool === 'pesquisarWeb'
          ? `🔍 Pesquisando na internet: "${toolCall.params?.query || '...'}"...`
          : toolCall.tool === 'buscarPagina'
          ? `📄 Acessando pagina: ${toolCall.params?.url || '...'}...`
          : `⚙️ Executando ${toolCall.tool}...`;
        if (sock && typeof sock.sendMessage === 'function') {
          await sock.sendMessage(sender, { text: statusMsg }).catch(() => {});
        }
      }

      const assistantMemory = (data.resposta ? data.resposta + '\n' : '') + JSON.stringify({ acao: toolCall.tool, parametros: toolCall.params || {} });
      await salvarMensagem('assistant', assistantMemory);

      const result = await executeToolCall(sender, { tool: toolCall.tool, params: toolCall.params || {} });

      if (result.metadata && result.metadata.requiresConfirmation) {
        await dbAdapter.salvarPendingAction(sender, toolCall.tool, result.metadata.toolCallRequest.params);
        if (sock && typeof sock.sendMessage === 'function') {
          await sock.sendMessage(sender, { text: `Preciso de permissao para: ${toolCall.tool}. Confirma? (sim/nao)` });
        }
        return;
      }

      if (result.metadata && result.metadata.immediateReply) {
        const reply = result.success
          ? `✅ ${result.data?.mensagem || 'Operacao concluida.'}`
          : `❌ ${result.error?.message || 'Erro desconhecido.'}`;
        await salvarMensagem('assistant', reply);
        if (sock && typeof sock.sendMessage === 'function') {
          await sock.sendMessage(sender, { text: reply });
        }
        return;
      }

      const formatted = formatToolResult(toolCall.tool, result);
      await salvarMensagem('system', formatted);

      return await processToolLoop(sock, sender, msg);
    }

    if (data.resposta) {
      await salvarMensagem('assistant', data.resposta);
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: data.resposta });
      }
    }
  } catch (error) {
    console.error('[PROCESS_TEXT][ERRO]', error);
    if (sock && typeof sock.sendMessage === 'function') {
      await sock.sendMessage(sender, { text: 'Erro interno ao processar sua solicitacao.' }).catch(e => {});
    } else {
      console.warn('[WHATSAPP] sock.sendMessage nao e uma funcao (erro no catch)');
    }
  }
}

const { initWhatsApp, getActiveSocket } = require('./src/plugins/whatsapp/connection');
const { handleMessage } = require('./src/plugins/whatsapp/messageHandler');

async function onMessageReceived(sock, messages, type) {
  try {
    await handleMessage(sock, messages, type, processTextMessage);
  } catch (err) { console.error('[MAIN][ERRO] onMessageReceived', err); }
}

(async () => {
  await dbAdapter.init();
  await dbAdapter.limparPendingActionsExpiradas();

  const restartFlag = path.resolve(__dirname, '.restart');
  let foiReinicio = false;
  try {
    if (fs.existsSync(restartFlag)) {
      foiReinicio = true;
      fs.unlinkSync(restartFlag);
    }
  } catch (e) {}

  const sock = await initWhatsApp(onMessageReceived);
  if (!sock) {
    console.error('[BOOT][FALHA] Nao foi possivel conectar ao WhatsApp');
    console.error('[BOOT] Escaneie o QR Code acima ou verifique a sessao em auth_info/');
    process.exit(1);
  }

  if (foiReinicio) {
    setTimeout(async () => {
      try {
        const cfg = require('./config.json');
        const contatos = cfg?.seguranca?.whitelist_contatos || [];
        for (const c of contatos) {
          if (sock && typeof sock.sendMessage === 'function') {
            await sock.sendMessage(c, { text: '🔄 Agente reiniciado com sucesso!' }).catch(() => {});
          }
        }
      } catch (e) {}
    }, 3000);
  }

  console.log('[BOOT] The A-gent pronto! Aguardando mensagens...');
})();
