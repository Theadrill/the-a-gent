const { buscarUltimasMensagens } = require('../memory/memoryManager');
const config = require('../../config.json');

// System Prompt mestre — definido uma única vez para evitar duplicação
const SYSTEM_PROMPT = `Você é um assistente de programação e automação chamado The A-gent.
Sua resposta DEVE estar SEMPRE em formato JSON válido, seguindo exatamente esta estrutura:
{
  "resposta": "string contendo sua resposta em linguagem natural",
  "acao": null,
  "parametros": null
}

Regras importantes:
1. Sempre responda em português do Brasil
2. O campo "resposta" deve conter sua mensagem para o usuário
3. O campo "acao" deve ser null se não houver ação a executar, ou uma string descrevendo a ação (ex: "criar_arquivo")
4. O campo "parametros" deve ser null se não houver parâmetros, ou um OBJETO com os parâmetros necessários (ex: {"caminho": "src/index.js"})
5. Não adicione texto fora do JSON, nem mesmo explicações ou prefixos como "Aqui está:"
6. Se não tiver certeza do que fazer, use acao: null e explique na resposta`;

/**
 * Constrói o prompt completo para envio ao LLM, injetando o histórico do SQLite.
 * @param {string} userInput - A entrada do usuário
 * @returns {Promise<string>} - O prompt formatado com instruções e histórico
 */
async function buildPrompt(userInput) {
  const maxBuffer = config.memoria.max_buffer || 15;
  const agora = new Date().toISOString();

  let historicoFormatado = '';

  try {
    const historico = await buscarUltimasMensagens(maxBuffer);
    historicoFormatado = historico
      .map(msg => `[${new Date(msg.timestamp).toISOString()}] ${msg.role}: ${msg.content}`)
      .join('\n');
  } catch (error) {
    // Se o banco falhar, continuamos sem histórico — não interrompemos o fluxo
    console.warn('[PromptBuilder] Aviso: não foi possível carregar o histórico:', error.message);
  }

  // Monta o prompt final: system + histórico + mensagem atual
  const promptCompleto = [
    SYSTEM_PROMPT,
    '\nHistórico da conversa (mensagens mais antigas primeiro):',
    historicoFormatado || '(sem histórico ainda)',
    `\n[${agora}] user: ${userInput}`,
    `[${agora}] assistant:`,
  ].join('\n');

  return promptCompleto;
}

module.exports = {
  buildPrompt,
};