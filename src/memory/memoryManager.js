const dbAdapter = require('./dbAdapter');

/**
 * Salva uma mensagem no banco.
 * @param {string} role - papel da mensagem, ex: 'user' | 'assistant' | 'system'
 * @param {string} content - conteúdo textual da mensagem
 * @returns {Promise<object>} - objeto com `id`, `role`, `content`, `timestamp`
 */
function salvarMensagem(role, content) {
  return dbAdapter.init().then((db) => {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now();
      const sql = 'INSERT INTO messages (role, content, timestamp) VALUES (?, ?, ?)';
      db.run(sql, [role, content, timestamp], function (err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, role, content, timestamp });
      });
    });
  });
}

/**
 * Busca as últimas mensagens (buffer de curto prazo).
 * Retorna um array em ordem cronológica (mais antigo -> mais recente).
 * @param {number} limite_buffer
 * @returns {Promise<Array<{id:number,role:string,content:string,timestamp:number}>>}
 */
function buscarUltimasMensagens(limite_buffer = 15) {
  return dbAdapter.init().then((db) => {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT id, role, content, timestamp FROM messages WHERE role IN (?, ?, ?) ORDER BY timestamp DESC LIMIT ?';
      db.all(sql, ['user', 'assistant', 'system', limite_buffer], (err, rows) => {
        if (err) return reject(err);
        // rows vem do mais recente ao mais antigo; inverter para cronológico
        resolve(rows.reverse());
      });
    });
  });
}

/**
 * Limpa todo o histórico de mensagens.
 * @returns {Promise<{changes:number}>}
 */
function limparHistorico() {
  return dbAdapter.init().then((db) => {
    return new Promise((resolve, reject) => {
      const sql = 'DELETE FROM messages';
      db.run(sql, [], function (err) {
        if (err) return reject(err);
        resolve({ changes: this.changes });
      });
    });
  });
}

/**
 * Remove a última mensagem do usuário do histórico.
 * Usado quando o usuário interrompe o processamento com "pare".
 * @returns {Promise<{removed: boolean, id: number|null}>}
 */
function removerUltimaMensagemUsuario() {
  return dbAdapter.init().then((db) => {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT id FROM messages WHERE role = ? ORDER BY timestamp DESC LIMIT 1';
      db.get(sql, ['user'], (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve({ removed: false, id: null });
        db.run('DELETE FROM messages WHERE id = ?', [row.id], function (err) {
          if (err) return reject(err);
          resolve({ removed: this.changes > 0, id: row.id });
        });
      });
    });
  });
}

module.exports = {
  salvarMensagem,
  buscarUltimasMensagens,
  limparHistorico,
  removerUltimaMensagemUsuario,
};
