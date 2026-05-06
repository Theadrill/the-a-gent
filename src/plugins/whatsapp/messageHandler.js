const { routeMedia } = require('../../orchestrator/mediaRouter');
const config = require('../../../config.json');
require('dotenv').config();

const processedIds = new Set();
const ID_CLEANUP_INTERVAL = 30000;

setInterval(() => {
  if (processedIds.size > 1000) processedIds.clear();
}, ID_CLEANUP_INTERVAL);

const IA_NUMBER = process.env.IA_NUMBER || null;

function isIaChat(remoteJid) {
  if (!remoteJid) return true;
  if (!IA_NUMBER) return true;

  const jidBase = remoteJid.split(':')[0].split('@')[0];

  if (jidBase === IA_NUMBER) return true;

  if (remoteJid.endsWith('@lid')) {
    const sock = global.__whatsapp_active_socket;
    if (sock && sock.user && sock.user.lid) {
      const lidBase = sock.user.lid.split(':')[0].split('@')[0];
      if (jidBase === lidBase) return true;
    }
  }

  return false;
}

const rawWhitelist = Array.isArray(config?.seguranca?.whitelist_contatos) ? config.seguranca.whitelist_contatos : [];
const whitelist = rawWhitelist.map(j => j.split(':')[0]);

function isAuthorized(jid, msg) {
  if (whitelist.length === 0) return true;
  
  const sock = global.__whatsapp_active_socket;

  // 1. Verifica se o JID do chat está na whitelist (ex: 5511... @s.whatsapp.net)
  const jidBase = jid.split(':')[0];
  if (whitelist.includes(jidBase)) return true;

  // 2. Verifica se o participante (em grupos ou se houver) está na whitelist
  const participant = msg?.key?.participant ? String(msg.key.participant).split(':')[0] : null;
  if (participant && whitelist.includes(participant)) return true;
  
  // 3. Se a mensagem for enviada por mim (fromMe), só autorizamos se:
  //    a) Eu estiver falando COMIGO MESMO (chat próprio)
  //    b) Eu estiver falando com alguém que está na whitelist
  if (msg?.key?.fromMe && sock?.user) {
    const myPhoneBase = sock.user.id.split(':')[0].split('@')[0];
    const myLidBase = sock.user.lid ? sock.user.lid.split(':')[0].split('@')[0] : null;
    const targetBase = jid.split('@')[0];

    // Verifica se o alvo da conversa sou eu mesmo (por número ou LID)
    const isTalkingToSelf = (targetBase === myPhoneBase || (myLidBase && targetBase === myLidBase));
    
    if (isTalkingToSelf || whitelist.includes(jidBase)) {
      return true;
    }
    
    // Se eu estiver falando com outra pessoa fora da whitelist, o bot ignora e não loga como erro
    return false;
  }

  console.log('[MESSAGE_HANDLER] msg rejeitada pelo isAuthorized', JSON.stringify(msg, (k, v) => k === 'message' && v ? '[MESSAGE]' : v));
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

    const now = Math.floor(Date.now() / 1000);

    for (const msg of messages) {
      try {
        const messageTimestamp = getMessageTimestamp(msg);
        if (!Number.isFinite(messageTimestamp)) continue;
        if (now - messageTimestamp > 60) continue;

        if (!msg.key) continue;
        const msgId = msg.key.id;
        if (msgId && processedIds.has(msgId)) continue;
        if (msgId) processedIds.add(msgId);

        const jid = String(msg.key?.remoteJid || '');
        console.log('[MESSAGE_HANDLER] Msg jid=' + jid + ' fromMe=' + msg.key?.fromMe + ' isIaChat=' + isIaChat(jid));
        if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue;
        if (!isIaChat(jid)) continue;
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
          if (msgContent.protocolMessage) continue;
          const knownMediaKeys = ['imageMessage', 'audioMessage', 'videoMessage', 'documentMessage', 'stickerMessage'];
          const hasMedia = knownMediaKeys.some(k => k in msgContent);
          if (hasMedia && typeof routeMedia === 'function') {
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
