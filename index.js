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
const config = require('./config.json');
const dbAdapter = require('./src/memory/dbAdapter');

if (!salvarMensagem || !buscarUltimasMensagens || !llmClient || !parseAndValidate || !buildPrompt) {
  console.error('[INDEX][CRITICO] Modulos da Fase 1 incompletos ou invalidos.');
  process.exit(1);
}

const maxBufferConfigured = Number(config?.memoria?.max_buffer || 0) || 0;
const MAX_BUFFER = Number.isFinite(maxBufferConfigured) && maxBufferConfigured > 0 ? maxBufferConfigured : 20;

async function processTextMessage(sock, sender, text, msg) {
  try {
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

    const safeText = text.length > 10000 ? text.slice(0, 10000) + '\n\n[TEXTO TRUNCADO]' : text;
    await dbAdapter.init();
    const historico = await buscarUltimasMensagens(MAX_BUFFER);
    const promptPayload = await buildPrompt(safeText);
    const respostaBruta = await llmClient(promptPayload);

    if (typeof respostaBruta !== 'string') throw new Error('Resposta do LLM invalida');
    const parsed = parseAndValidate(respostaBruta);

    if (!parsed || !parsed.data || !parsed.data.resposta) {
      throw new Error('Resposta do LLM nao contem o campo "resposta"');
    }

    await salvarMensagem('user', safeText);
    await salvarMensagem('assistant', parsed.data.resposta);

    if (sock && typeof sock.sendMessage === 'function') {
      await sock.sendMessage(sender, { text: parsed.data.resposta });
    } else {
      console.warn('[WHATSAPP] sock.sendMessage nao e uma funcao');
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
  const sock = await initWhatsApp(onMessageReceived);
  if (!sock) {
    console.error('[MAIN][CRITICO] Falha ao iniciar socket');
    process.exit(1);
  }
})();
