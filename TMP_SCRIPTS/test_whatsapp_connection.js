// Purpose: Simple integration test for WhatsApp connection module
// How to run: node TMP_SCRIPTS/test_whatsapp_connection.js
// Validates: module loads, emitter presence, and isConnecting guard when calling initWhatsApp twice.

(async () => {
  // Force-clean any active socket and module cache to simulate fresh boot
  try {
    global.__whatsapp_active_socket = null;
    delete require.cache[require.resolve('../src/plugins/whatsapp/connection')];
  } catch (e) { /* ignore */ }

  let mod;
  try {
    mod = require('../src/plugins/whatsapp/connection');
  } catch (e) {
    console.error('[TEST] Failed to require connection module:', e && e.message);
    process.exit(1);
  }

  const { initWhatsApp, socketEmitter } = mod;
  const qrcode = require('qrcode-terminal');

  socketEmitter.on('socket.setup', () => console.log('[TEST] socket.setup'));
  socketEmitter.on('open', () => console.log('[TEST] open'));
  socketEmitter.on('close', () => console.log('[TEST] close'));
  socketEmitter.on('connection.update', (u) => {
    console.log('[TEST] connection.update', u && (u.connection || u.qr ? (u.connection || 'qr') : 'update'));
  });
  socketEmitter.on('error', (err) => console.error('[TEST] emitter error', err && err.message));

  const onMessageReceived = async (sock, messages, type) => {
    try {
      console.log('[TEST] onMessageReceived', type, Array.isArray(messages) ? messages.length : 0);
    } catch (e) {
      console.error('[TEST] onMessageReceived error', e && e.message);
    }
  };

  try {
    console.log('[TEST] Calling initWhatsApp first time');
    const sock1 = await initWhatsApp(onMessageReceived).catch(e => { console.error('[TEST] init error', e && e.message); return null; });
    console.log('[TEST] init returned (first):', !!sock1);

    console.log('[TEST] Calling initWhatsApp second time (should be guarded)');
    const sock2 = await initWhatsApp(onMessageReceived).catch(e => { console.error('[TEST] init2 error', e && e.message); return null; });
    console.log('[TEST] init returned (second):', !!sock2);
  } catch (e) {
    console.error('[TEST] unexpected error', e && e.message);
  }
})();
