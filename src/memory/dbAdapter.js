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

      const createSQL = `
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        )`;

      db.run(createSQL, (err) => {
        if (err) return reject(err);
        resolve(db);
      });
    });
  });
}

function getDb() {
  if (!db) throw new Error('Banco de dados não inicializado. Chame init() primeiro.');
  return db;
}

module.exports = {
  init,
  getDb,
  dbPath,
};
