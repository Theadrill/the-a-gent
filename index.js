/**
 * index.js - O Maestro (Entry Point)
 * 
 * Este arquivo orquestra a comunicação entre o usuário, o banco de dados de memória
 * e o cérebro (LLM). Nesta Fase 1, a interação é feita via terminal (CLI).
 */

const readline = require('readline');
const dbAdapter = require('./src/memory/dbAdapter');
const memoryManager = require('./src/memory/memoryManager');
const promptBuilder = require('./src/core/promptBuilder');
const llmClient = require('./src/core/llmClient');
const jsonExtractor = require('./src/core/jsonExtractor');

// Configuração da interface de leitura do terminal
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '👤 Você > '
});

/**
 * Função principal que inicializa o sistema e inicia o loop de conversa.
 */
async function start() {
  console.log('\n--- 🤖 The A-gent: Fase 1 (Cérebro e Memória) ---');
  console.log('Iniciando sistema e banco de dados...\n');

  try {
    // 1. Inicializa o banco de dados SQLite
    await dbAdapter.init();
    console.log('✅ Memória de longo prazo pronta.');
    console.log('Digite sua mensagem para começar. Digite "sair" para encerrar.\n');

    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();

      if (input.toLowerCase() === 'sair') {
        console.log('\nDesligando o sistema... Até logo!');
        process.exit(0);
      }

      if (!input) {
        rl.prompt();
        return;
      }

      try {
        // 2. Salva a mensagem do usuário no banco de dados
        await memoryManager.salvarMensagem('user', input);

        console.log('\n🧠 O Agente está pensando...');

        // 3. Constrói o prompt com base no histórico e entrada atual
        const prompt = await promptBuilder.buildPrompt(input);

        // 4. Envia para o LLM
        const rawResponse = await llmClient.llmClient(prompt);

        // 5. Extrai e valida o JSON da resposta
        const extraction = jsonExtractor.parseAndValidate(rawResponse);
        const { data, success, error } = extraction;

        // 6. Salva a resposta (texto natural) do assistente no banco
        await memoryManager.salvarMensagem('assistant', data.resposta);

        // 7. Exibe o resultado formatado
        console.log('\n--- 🤖 Resposta do Agente ---');
        console.log(`Mensagem: ${data.resposta}`);
        
        if (data.acao) {
          console.log(`Ação Detectada: ${data.acao}`);
          console.log(`Parâmetros: ${JSON.stringify(data.parametros, null, 2)}`);
        }

        if (!success) {
          console.warn(`\n⚠️ Aviso: Resposta JSON instável. Erro: ${error}`);
        }

        console.log('-----------------------------\n');

      } catch (err) {
        console.error('\n❌ Erro no ciclo de processamento:', err.message);
      }

      rl.prompt();
    });

  } catch (error) {
    console.error('\n❌ Erro fatal ao iniciar o sistema:', error.message);
    process.exit(1);
  }
}

// Inicia o programa
start();
