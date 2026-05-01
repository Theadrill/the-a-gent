const config = require('../../config.json');
require('dotenv').config();

/**
 * Cliente LLM que envia requisições para a API do Ollama (ou fallback)
 * @param {string} prompt - O prompt completo para enviar ao modelo
 * @returns {Promise<string>} - A resposta bruta do modelo em texto
 */
async function llmClient(prompt) {
  const currentProvider = config.api.provider || 'ollama';
  const hostname = process.env.OLLAMA_HOST || config.api.hostname || 'localhost';
  const port = process.env.OLLAMA_PORT || config.api.port || 11434;
  const model = config.api.model || 'llama3.2';

  try {
    let apiUrl;
    let requestBody;

    if (currentProvider === 'ollama') {
      apiUrl = `http://${hostname}:${port}/api/generate`;
      requestBody = {
        model: model,
        prompt: prompt,
        stream: false,
        format: "json", // Força o Ollama a responder APENAS JSON
        options: {
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 2048
        }
      };
    } else if (currentProvider === 'gemini') {
      // Implementação futura para Gemini
      throw new Error('Provedor Gemini não implementado ainda');
    } else {
      throw new Error(`Provedor não suportado: ${currentProvider}`);
    }

    console.log(`[LLM] Enviando request para ${currentProvider} em ${apiUrl} (modelo: ${model})`);
    console.log(`[LLM] Tamanho do prompt: ${prompt.length} caracteres`);

    const startTime = Date.now();
    let response;
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000)
      });
    } catch (fetchErr) {
      console.error(`[LLM][ERRO] Fetch falhou apos ${Date.now() - startTime}ms: ${fetchErr.message}`);
      throw fetchErr;
    }

    const elapsed = Date.now() - startTime;
    console.log(`[LLM] Resposta recebida em ${elapsed}ms, status: ${response.status}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log(`[LLM] JSON parseado, response.length=${data.response ? data.response.length : 0}`);

    if (currentProvider === 'ollama' && data.response) {
      return data.response;
    } else {
      return typeof data === 'string' ? data : JSON.stringify(data);
    }
  } catch (error) {
    console.error(`[LLM] Erro no provedor ${currentProvider}:`, error.message);

    const fallbackProvider = config.api.fallback_provider;

    // Lógica de fallback
    if (fallbackProvider && currentProvider !== fallbackProvider) {
      console.warn(`[LLM] Tentando fallback para ${fallbackProvider}...`);

      // Backup e restauração do config global para evitar mutação permanente
      const originalProvider = config.api.provider;
      config.api.provider = fallbackProvider;

      try {
        return await llmClient(prompt);
      } catch (fallbackError) {
        throw new Error(`Falha em ambos os provedores. Primário: ${error.message}. Fallback: ${fallbackError.message}`);
      } finally {
        config.api.provider = originalProvider;
      }
    } else {
      throw error;
    }
  }
}

module.exports = {
  llmClient
};