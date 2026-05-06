/**
 * TMP_SCRIPTS/test_media_download.js
 *
 * PROPOSITO: Testar o recebimento e download de arquivos via WhatsApp,
 *            independentemente do cerebro (LLM). O bot opera em modo "eco".
 *
 * COMO EXECUTAR: node TMP_SCRIPTS/test_media_download.js
 *
 * O QUE VALIDA:
 *   1. A conexao com o WhatsApp funciona (QR Code ou sessao salva).
 *   2. O bot recebe um arquivo de codigo (.js, .txt, etc.) enviado pelo celular.
 *   3. O arquivo e salvo com sucesso em ./temp_workspace/.
 *   4. O conteudo do arquivo e lido e impresso no console.
 *   5. O bot responde no WhatsApp confirmando o recebimento e mostrando um preview.
 *
 * COMO USAR:
 *   - Inicie o script.
 *   - Escaneie o QR Code OU aguarde a reconexao automatica.
 *   - Envie um arquivo .js ou .txt para o numero do bot via WhatsApp.
 *   - Observe o console e aguarde a resposta de confirmacao no WhatsApp.
 */

const { initWhatsApp, socketEmitter } = require('../src/plugins/whatsapp/connection');
const { handleFile } = require('../src/orchestrator/fileHandler');

let currentSock = null;

socketEmitter.on('socket', (sock) => {
  currentSock = sock;
});

const CONNECTION_TIMEOUT_MS = 20000;

const timeout = setTimeout(() => {
  console.error('[TEST_MEDIA] erro de inicializacao, socket nao recebido');
  process.exit(1);
}, CONNECTION_TIMEOUT_MS);

socketEmitter.on('socket.setup', (sock) => {
  clearTimeout(timeout);
  currentSock = sock;
  console.log('[TEST_MEDIA] Socket pronto');
});

async function onMessageReceived(sock, messages, type) {
  try {
    if (type !== 'notify') return;
    if (!Array.isArray(messages)) return;

    for (const msg of messages) {
      try {
        if (msg.key?.fromMe) continue;
        if (!msg.message) continue;

        const msgContent = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message;
        if (!msgContent) continue;

        const jid = String(msg.key?.remoteJid || '');
        if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

        const text = msgContent?.conversation || msgContent?.extendedTextMessage?.text || null;

        if (text !== null) {
          console.log('[TEST_MEDIA] Mensagem de texto recebida:', text);
          if (sock && typeof sock.sendMessage === 'function') {
            await sock.sendMessage(jid, { text: `Eco: ${text}` });
          }
          continue;
        }

        if (msgContent.documentMessage) {
          const doc = msgContent.documentMessage;
          const fileName = doc.fileName || 'unnamed';
          console.log('[TEST_MEDIA] Arquivo recebido:', fileName);

          await handleFile(sock, jid, msg, async (sock, sender, fullText, msg) => {
            try {
              const lines = fullText.split('\n');
              const preview = lines.slice(0, 3).join('\n').slice(0, 100);
              const response = `📄 Arquivo recebido: ${String(doc.fileName || 'unnamed').replace(/[^a-zA-Z0-9._-]/g, '_')} (Preview: ${preview}...)`;
              if (sock && typeof sock.sendMessage === 'function') {
                await sock.sendMessage(sender, { text: response });
              }
              console.log('[TEST_MEDIA] Preview enviado para o usuario');
            } catch (e) {
              console.error('[TEST_MEDIA] Erro no callback:', e);
            }
          });
        } else if (msgContent.imageMessage) {
          if (sock && typeof sock.sendMessage === 'function') {
            await sock.sendMessage(jid, { text: '🖼️ Imagem recebida (modo eco)' });
          }
        } else if (msgContent.audioMessage) {
          if (sock && typeof sock.sendMessage === 'function') {
            await sock.sendMessage(jid, { text: '🎙️ Audio recebido (modo eco)' });
          }
        } else {
          if (sock && typeof sock.sendMessage === 'function') {
            await sock.sendMessage(jid, { text: 'Midia recebida (modo eco)' });
          }
        }
      } catch (innerErr) {
        console.error('[TEST_MEDIA] Erro processando mensagem:', innerErr);
      }
    }
  } catch (err) {
    console.error('[TEST_MEDIA] Erro em onMessageReceived:', err);
  }
}

(async () => {
  console.log('[TEST_MEDIA] Iniciando conexao WhatsApp (modo eco)...');
  const sock = await initWhatsApp(onMessageReceived);
  if (!sock) {
    console.error('[TEST_MEDIA] initWhatsApp retornou null');
  }
})();
