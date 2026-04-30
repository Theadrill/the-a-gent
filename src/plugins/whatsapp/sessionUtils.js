const fs = require('fs');
const path = require('path');
const os = require('os');
const { useMultiFileAuthState } = require('baileys');
const qrcode = require('qrcode-terminal');

// Simple per-authDir save queue
const credsSaveQueues = new Map();

function resolveDefaultAuthDir() {
  // default to ./auth_info
  return path.resolve(process.cwd(), 'auth_info');
}

async function writeCredsJsonAtomically(authDir, creds) {
  const credsPath = path.join(authDir, 'creds.json');
  const tempPath = path.join(authDir, `.creds.${process.pid}.${Date.now()}.tmp`);
  const json = JSON.stringify(creds, null, 2);
  try {
    fs.writeFileSync(tempPath, json, { encoding: 'utf8' });
    fs.renameSync(tempPath, credsPath);
    try { fs.chmodSync(credsPath, 0o600); } catch (e) {}
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (e) {}
    throw err;
  }
}

function enqueueCredsSave(authDir, saveFn) {
  const key = authDir;
  const next = (credsSaveQueues.get(key) || Promise.resolve()).then(() => saveFn()).catch(() => {}).finally(() => {
    if (credsSaveQueues.get(key) === next) credsSaveQueues.delete(key);
  });
  credsSaveQueues.set(key, next);
}

function waitForCredsSaveQueueWithTimeout(authDir, timeoutMs = 5000) {
  const p = credsSaveQueues.get(authDir) || Promise.resolve();
  return Promise.race([p.then(() => 'drained'), new Promise((res) => setTimeout(() => res('timed_out'), timeoutMs))]);
}

function restoreCredsFromBackupIfNeeded(authDir) {
  // simple no-op for now (placeholder for more advanced restore)
  return Promise.resolve(false);
}

async function createWaSocket({ authDir, onQr, printQr = false, logger } = {}) {
  const resolvedAuthDir = authDir || resolveDefaultAuthDir();
  try { fs.mkdirSync(resolvedAuthDir, { recursive: true }); } catch (e) {}

  // wait for any queued saves
  await waitForCredsSaveQueueWithTimeout(resolvedAuthDir, 5000);

  await restoreCredsFromBackupIfNeeded(resolvedAuthDir);

  const { state } = await useMultiFileAuthState(resolvedAuthDir);

  // create a minimal object matching expected by makeWASocket
  const auth = state;

  return { auth, state, saveCreds: async () => { await writeCredsJsonAtomically(resolvedAuthDir, state.creds); } };
}

module.exports = { writeCredsJsonAtomically, enqueueCredsSave, waitForCredsSaveQueueWithTimeout, restoreCredsFromBackupIfNeeded, createWaSocket, resolveDefaultAuthDir };
