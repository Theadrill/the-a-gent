const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Lê o caminho do DB a partir do config.json (fallback para ./data/agent_memory.db)
const config = require('../../config.json');
const dbPath = path.resolve(process.cwd(), (config && config.memoria && config.memoria.db_path) ? config.memoria.db_path : './data/agent_memory.db');

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDirForFile(dbPath);

let db = null;

/**
 * Inicializa a conexão com o SQLite e cria a tabela `messages` se não existir.
 * Retorna uma Promise que resolve com o objeto `Database`.
 */
function init() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);

    db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);

      const createMessages = `
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        )`;

      const createPending = `
        CREATE TABLE IF NOT EXISTS pending_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender TEXT NOT NULL,
          tool TEXT NOT NULL,
          params TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )`;

      db.run(createMessages, (err) => {
        if (err) return reject(err);
        db.run(createPending, (err) => {
          if (err) return reject(err);
          resolve(db);
        });
      });
    });
  });
}

function getDb() {
  if (!db) throw new Error('Banco de dados não inicializado. Chame init() primeiro.');
  return db;
}

function salvarPendingAction(sender, tool, params) {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    const expiresAt = now + 5 * 60 * 1000;
    const sql = 'INSERT INTO pending_actions (sender, tool, params, created_at, expires_at) VALUES (?, ?, ?, ?, ?)';
    db.run(sql, [sender, tool, JSON.stringify(params), now, expiresAt], function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, sender, tool, params });
    });
  });
}

function buscarPendingAction(sender) {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    const sql = 'SELECT id, tool, params, created_at FROM pending_actions WHERE sender = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1';
    db.get(sql, [sender, now], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);
      resolve({ id: row.id, tool: row.tool, params: JSON.parse(row.params) });
    });
  });
}

function removerPendingAction(id) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM pending_actions WHERE id = ?';
    db.run(sql, [id], function (err) {
      if (err) return reject(err);
      resolve({ removed: this.changes > 0 });
    });
  });
}

function limparPendingActionsExpiradas() {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    const sql = 'DELETE FROM pending_actions WHERE expires_at < ?';
    db.run(sql, [now], function (err) {
      if (err) return reject(err);
      resolve({ removidas: this.changes });
    });
  });
}

module.exports = {
  init,
  getDb,
  dbPath,
  salvarPendingAction,
  buscarPendingAction,
  removerPendingAction,
  limparPendingActionsExpiradas,
};
