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

const MAX_TOOL_ITERATIONS = 5;

console.log('[BOOT] The A-gent iniciando...');
console.log('[BOOT] Provedor:', config.api.provider, '/ Modelo:', config.api.model);
console.log('[BOOT] Buffer de memoria:', MAX_BUFFER, 'mensagens');
console.log('[BOOT] Max iteracoes de ferramenta:', MAX_TOOL_ITERATIONS);
console.log('[BOOT] Conectando ao WhatsApp...');

async function processToolLoop(sock, sender, msg) {
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    console.log('[LOOP] Iteracao', iterations, 'de', MAX_TOOL_ITERATIONS);

    const historico = await buscarUltimasMensagens(MAX_BUFFER);
    const promptPayload = await buildPrompt('[Continuacao automatica]', historico);
    const respostaBruta = await llmClient(promptPayload);

    if (typeof respostaBruta !== 'string') {
      throw new Error('Resposta do LLM invalida no loop');
    }

    const parsed = parseAndValidate(respostaBruta);
    if (!parsed || !parsed.data) {
      throw new Error('Resposta do LLM nao contem dados validos');
    }

    const data = parsed.data;

    const toolCall = data.tool_call || (data.acao && data.acao !== null
      ? { tool: data.acao, params: data.parametros }
      : null);

    if (!toolCall) {
      if (data.resposta) {
        await salvarMensagem('assistant', data.resposta);
        if (sock && typeof sock.sendMessage === 'function') {
          await sock.sendMessage(sender, { text: data.resposta });
        }
      }
      return;
    }

    console.log('[LOOP] Chamando ferramenta:', toolCall.tool);
    const result = await executeToolCall({ tool: toolCall.tool, params: toolCall.params || {}, skipConfirmation: true });
    console.log('[LOOP] Resultado da ferramenta: success=' + result.success + ' error=' + (result.error || 'none'));

    if (result.success) {
      const toolResultMsg = formatToolResult(toolCall.tool, result);
      await salvarMensagem('system', toolResultMsg);
      const promptPayload = await buildPrompt('[Gere uma resposta natural para o usuario informando o resultado da ferramenta acima. Nao chame ferramentas.]');
      const respostaBruta = await llmClient(promptPayload);
      if (typeof respostaBruta === 'string') {
        const parsed = parseAndValidate(respostaBruta);
        const reply = parsed?.data?.resposta || toolResultMsg;
        await salvarMensagem('assistant', reply);
        if (sock && typeof sock.sendMessage === 'function') {
          await sock.sendMessage(sender, { text: reply });
        }
      }
      return;
    }

    const formatted = formatToolResult(toolCall.tool, result);
    await salvarMensagem('system', formatted);
  }

  console.log('[LOOP] Maximo de iteracoes atingido');
  if (sock && typeof sock.sendMessage === 'function') {
    await sock.sendMessage(sender, { text: 'Nao foi possivel concluir a operacao apos varias tentativas. Tente simplificar o comando.' });
  }
}

async function processTextMessage(sock, sender, text, msg) {
  try {
    console.log('[PROCESS_TEXT] Mensagem recebida de', sender, ':', text ? text.slice(0, 50) : '(midia)');

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
      const result = await executeToolCall({ tool: pendingAction.tool, params: pendingAction.params });
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
    const respostaBruta = await llmClient(promptPayload);

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

      if (toolCall.tool === 'reiniciarAgente') {
        await salvarMensagem('assistant', 'Reiniciando o agente...');
        const result = await executeToolCall({ tool: 'reiniciarAgente', params: {}, skipConfirmation: true });
        if (sock && typeof sock.sendMessage === 'function') {
          await sock.sendMessage(sender, { text: result.success ? '🔄 Reiniciando...' : `Falha: ${result.error}` });
        }
        return;
      }

      const result = await executeToolCall({ tool: toolCall.tool, params: toolCall.params || {} });

      if (result.metadata && result.metadata.requiresConfirmation) {
        await dbAdapter.salvarPendingAction(sender, toolCall.tool, result.metadata.toolCallRequest.params);
        if (sock && typeof sock.sendMessage === 'function') {
          await sock.sendMessage(sender, { text: `Preciso de permissao para: ${toolCall.tool}. Confirma? (sim/nao)` });
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

const { initWhatsApp } = require('./src/plugins/whatsapp/connection');
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
