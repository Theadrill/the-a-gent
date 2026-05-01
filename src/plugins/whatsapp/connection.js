const events = require('events');
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { makeWASocket, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } = require('baileys');

// Singleton emitter (global guard to keep single instance across reloads)
if (!global.__whatsapp_socket_emitter) global.__whatsapp_socket_emitter = new events.EventEmitter();
const socketEmitter = global.__whatsapp_socket_emitter;
socketEmitter.setMaxListeners(30);

// Connection lock (object wrapper so we can mutate from inner scopes)
const isConnecting = { value: false };

// Active socket singleton (stored on global to survive reloads)
if (!global.__whatsapp_active_socket) global.__whatsapp_active_socket = null;

function getActiveSocket() {
  return global.__whatsapp_active_socket;
}

function setActiveSocket(sock) {
  global.__whatsapp_active_socket = sock;
}

const RECONNECT_DELAY = 5000; // ms
let reconnectTimer = null;

const logger = pino({ level: process.env.LOG_LEVEL || 'error' });

async function initWhatsApp(onMessageReceived, options = {}) {
  try {
    if (typeof onMessageReceived !== 'function') throw new Error('onMessageReceived must be a function');

    // Return existing active socket early, before acquiring the lock
    if (getActiveSocket()) {
      logger.info('[WHATSAPP][STATUS] Returning existing active socket');
      return getActiveSocket();
    }

    if (isConnecting.value) {
      logger.info('[WHATSAPP][STATUS] init attempted while already connecting');
      return null;
    }

    isConnecting.value = true; // acquire lock

    const authFolder = options.authFolder || path.resolve(process.cwd(), 'auth_info');
    let state, saveCreds;
    try {
      const result = await useMultiFileAuthState(authFolder);
      state = result.state;
      saveCreds = result.saveCreds;
    } catch (err) {
      isConnecting.value = false;
      logger.error(`[WHATSAPP][ERRO] Auth state falhou: ${err.message}`);
      return null;
    }
    if (!state) {
      isConnecting.value = false;
      logger.error('[WHATSAPP][ERRO] Auth state retornou nulo');
      return null;
    }
    const auth = state;

    // Buscar versão para contornar bloqueios/erros 405 (Method Not Allowed)
    const { version } = await fetchLatestBaileysVersion();

    // Create the socket com configuração explícita de browser e versão
    const sock = makeWASocket({ 
      auth, 
      logger,
      version,
      browser: ['The A-gent', 'Chrome', '120.0.0']
    });
    try { setActiveSocket(sock); } catch (e) { /* best-effort */ }

    sock.ev.on('creds.update', async () => {
      try {
        if (typeof saveCreds === 'function') await saveCreds();
      } catch (err) {
        console.error('[WHATSAPP][ERRO] creds.update', err);
      }
    });

    // connection.update handler
    sock.ev.on('connection.update', async (update) => {
      try {
        logger.info('[WHATSAPP][STATUS] ' + JSON.stringify(update));
        socketEmitter.emit('connection.update', update);

        if (update.qr) {
          try {
            console.log('[WHATSAPP] QR Code gerado. Escaneie com o WhatsApp.');
            qrcode.generate(update.qr, { small: true });
          } catch (e) { /* non-fatal */ }
        }

        if (update.connection === 'open') {
          console.log('[WHATSAPP] Conectado!');
          socketEmitter.emit('open', update);
          // mark active and Ponto C: reset antes do retorno bem-sucedido
          try { setActiveSocket(sock); } catch (e) { /* best-effort */ }
          isConnecting.value = false;
          if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        }

        if (update.connection === 'close') {
          try {
            logger.error('[WHATSAPP][ERRO] connection closed');
            socketEmitter.emit('close', update);

            sock.ev.removeAllListeners();
            isConnecting.value = false;
            // clear active socket
            try { setActiveSocket(null); } catch (e) { /* best-effort */ }

            // Check explicit logout reason
            const lastDisconnect = update.lastDisconnect || {};
            const reason = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.statusCode || null;
            if (reason === DisconnectReason.loggedOut) {
              logger.error('[WHATSAPP][ERRO] logged out - user must reauthenticate');
              return;
            }

            // Schedule reconnection safely
            if (!reconnectTimer) {
              reconnectTimer = setTimeout(() => {
                reconnectTimer = null; // Limpar o timer antes de tentar
                try {
                  if (isConnecting.value) return; 
                  initWhatsApp(onMessageReceived, options).catch(err => logger.error(`[WHATSAPP][ERRO] reconectar ${err && err.message}`));
                } catch (e) {
                  logger.error(`[WHATSAPP][ERRO] reconnection scheduling failed ${e && e.message}`);
                }
              }, RECONNECT_DELAY);
            }
          } catch (err) {
            logger.error(`[WHATSAPP][ERRO] connection.update(close) handler ${err && err.message}`);
            isConnecting.value = false; // defensive reset in handler if something else fails
          }
        }
      } catch (err) {
        logger.error(`[WHATSAPP][ERRO] connection.update generic ${err && err.message}`);
      }
    });

    // messages.upsert handler
    sock.ev.on('messages.upsert', async (payload) => {
      try {
        const messages = Array.isArray(payload?.messages) ? payload.messages : [];
        if (!messages.length) return;
        try {
          await onMessageReceived(sock, messages, payload.type);
        } catch (innerErr) {
          logger.error(`[WHATSAPP][ERRO] onMessageReceived handler ${innerErr && innerErr.message}`);
        }
      } catch (err) {
        logger.error(`[WHATSAPP][ERRO] messages.upsert ${err && err.message}`);
      }
    });

    socketEmitter.emit('socket', sock);
    isConnecting.value = false; // Ponto C: reset explicito antes do return
    return sock;
  } catch (error) {
    // Ponto A: reset em falha de boot
    try { isConnecting.value = false; } catch (e) { /* best-effort */ }
    logger.error(`[WHATSAPP][ERRO] initWhatsApp ${error && error.message}`);
    socketEmitter.emit('error', error);
    return null;
  }
}

module.exports = { initWhatsApp, socketEmitter };
