const { routeMedia } = require('../../orchestrator/mediaRouter');
const config = require('../../../config.json');

const rawWhitelist = Array.isArray(config?.seguranca?.whitelist_contatos) ? config.seguranca.whitelist_contatos : [];
const whitelist = rawWhitelist.map(j => j.split(':')[0]);

function isAuthorized(jid, msg) {
  if (whitelist.length === 0) return true;
  const jidBase = jid.split(':')[0];
  if (whitelist.includes(jidBase)) return true;
  const participant = msg?.key?.participant ? String(msg.key.participant).split(':')[0] : null;
  if (participant && whitelist.includes(participant)) return true;
  if (msg?.key?.fromMe && jid.endsWith('@lid')) {
    const meStr = msg?.key?.remoteJid || '';
    if (meStr.endsWith('@lid')) return true;
  }
  console.log('[MESSAGE_HANDLER] msg rejeitada', JSON.stringify(msg, (k, v) => k === 'message' && v ? '[MESSAGE]' : v));
  return false;
}

function getMessageTimestamp(msg) {
  const raw = msg?.messageTimestamp || msg?.key?.timestamp || msg?.message?.timestamp || 0;
  let ts = Number(raw) || 0;
  if (ts > 1e12) ts = Math.floor(ts / 1000);
  return Math.floor(ts);
}

async function handleMessage(sock, messages, type, processTextMessage) {
  try {
    if (type !== 'notify') return;
    if (!Array.isArray(messages)) return;

    console.log('[MESSAGE_HANDLER] Recebidas ' + messages.length + ' mensagens, tipo: ' + type);

    const now = Math.floor(Date.now() / 1000);

    for (const msg of messages) {
      try {
        console.log('[MESSAGE_HANDLER] Msg fromMe=' + msg.key?.fromMe + ' jid=' + msg.key?.remoteJid + ' id=' + msg.key?.id);
        const messageTimestamp = getMessageTimestamp(msg);
        if (!Number.isFinite(messageTimestamp)) continue;
        if (now - messageTimestamp > 60) continue;

        if (!msg.key) {
          console.log('[MESSAGE_HANDLER] mensagem sem key, pulando');
          continue;
        }
        const jid = String(msg.key?.remoteJid || '');
        if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue;
        if (!isAuthorized(jid, msg)) continue;
        if (!msg.message) continue;

        const msgContent =
          msg.message?.ephemeralMessage?.message ||
          msg.message?.viewOnceMessage?.message ||
          msg.message;

        if (!msgContent) continue;

        const sender = jid;

        const text =
          msgContent?.conversation ||
          msgContent?.extendedTextMessage?.text ||
          null;

        if (text === null) {
          if (typeof routeMedia === 'function') {
            await routeMedia(sock, sender, msgContent, msg, processTextMessage);
          }
        } else {
          if (typeof processTextMessage === 'function') {
            await processTextMessage(sock, sender, text, msg);
          }
        }
      } catch (innerErr) {
        console.error('[MESSAGE_HANDLER][ERRO] mensagem individual', innerErr);
      }
    }
  } catch (error) {
    console.error('[MESSAGE_HANDLER][ERRO]', error);
  }
}

module.exports = { handleMessage };
