/*
 * test_memory.js
 * Propósito: Teste rápido de integração para o gerenciador de memória (SQLite).
 * Descrição: Salva uma mensagem de exemplo, recupera as últimas mensagens,
 *            imprime-as no console e depois limpa o histórico.
 * Como executar: a partir da raiz do projeto execute `node TMP_SCRIPTS/test_memory.js`
 */

const path = require('path');
const memory = require(path.join('..', 'src', 'memory', 'memoryManager'));

async function main() {
  try {
    console.log('Iniciando teste do memoryManager...');

    const saved = await memory.salvarMensagem('user', 'Olá, quem é você? (teste)');
    console.log('Mensagem salva:', saved);

    const últimas = await memory.buscarUltimasMensagens(10);
    console.log('Últimas mensagens (cronológico):', últimas);

    const cleared = await memory.limparHistorico();
    console.log('Histórico limpo:', cleared);

    console.log('Teste concluído.');
  } catch (err) {
    console.error('Erro no teste de memória:', err);
    process.exitCode = 1;
  }
}

main();
