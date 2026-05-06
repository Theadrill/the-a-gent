/**
 * Arquivo: /src/tools/webScraper.js
 * 
 * PROPÓSITO: Extrair conteúdo textual de uma única URL de forma segura e eficiente.
 *            Utiliza o motor CheerioCrawler (Crawlee) para processamento leve (HTTP puro).
 * 
 * ENTRADAS: url (string)
 * SAÍDAS: { success: boolean, data?: { url, titulo, conteudo, tamanhoOriginal, tamanhoExtraido }, error?: string }
 */

const { CheerioCrawler, Configuration, purgeDefaultStorages, log } = require('crawlee');
const fs = require('fs');
const path = require('path');
const { validateUrl } = require('../core/securityLayer');
const { REMOVE_SELECTORS, cleanExtractedText } = require('../utils/htmlSanitizer');
const ToolResult = require('../core/toolResult');
const config = require('../../config.json');

/**
 * Busca o conteúdo de uma página e retorna o texto sanitizado.
 */
async function buscarPagina(url) {
  // 1. Defesa SSRF: Validar URL antes de qualquer requisição
  const urlCheck = await validateUrl(url);
  if (urlCheck.status !== 'allowed') {
    return ToolResult.error('SSRF_BLOCK', `URL bloqueada por politica de seguranca (SSRF): ${urlCheck.reason}`);
  }
  const safeUrl = urlCheck.sanitizedUrl;

  // 2. Configuração do ambiente Crawlee
  const tempDir = path.join(process.cwd(), 'temp_workspace', `crawlee_${Date.now()}`);
  process.env.CRAWLEE_STORAGE_DIR = tempDir;

  const crawleeConfig = new Configuration({
    persistStorage: false, // Tudo em memória para evitar lixo no disco
    purgeOnStart: true,
      logLevel: log.LEVELS.OFF,
    });

  let resultado = null;
  let errorMsg = null;

  try {
    const crawler = new CheerioCrawler({
      minConcurrency: 1,
      maxConcurrency: 1,
      requestHandlerTimeoutSecs: 25,
      navigationTimeoutSecs: 15,
      maxRequestRetries: 1,
      maxRequestsPerCrawl: 1,
      
      // Bloqueio de erros HTTP comuns para tool calls
      additionalHttpErrorStatusCodes: [403, 503, 429],

      requestHandler: async ({ request, $, response }) => {
        // A. Validar Content-Type
        const contentType = response?.headers?.['content-type'] || '';
        const isHTML = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
        const isText = contentType.includes('text/plain');
        const isJSON = contentType.includes('application/json');
        
        if (!isHTML && !isText && !isJSON) {
          errorMsg = `Tipo de conteúdo não suportado: ${contentType}. Apenas HTML, texto e JSON são aceitos.`;
          return;
        }

        // B. Validar tamanho (Máximo 5MB)
        const bodySize = response?.body?.length || 0;
        if (bodySize > 5 * 1024 * 1024) {
          errorMsg = `Página muito grande (${(bodySize / 1024 / 1024).toFixed(1)} MB). Limite: 5 MB.`;
          return;
        }

        // C. Extração e Sanitização
        const titulo = $('title').first().text().trim() || 'Sem título';
        
        // Remove elementos ruidosos ANTES de pegar o texto
        REMOVE_SELECTORS.forEach(selector => {
          try { $(selector).remove(); } catch (e) {}
        });

        const bodyText = $('body').text() || $.text();
        let textoLimpo = cleanExtractedText(bodyText);

        // D. Truncamento Inteligente (Configurável)
        const MAX_CHARS = config.web?.max_extracted_chars || 15000;
        if (textoLimpo.length > MAX_CHARS) {
          textoLimpo = textoLimpo.slice(0, MAX_CHARS);
          const lastSpace = textoLimpo.lastIndexOf(' ');
          if (lastSpace > MAX_CHARS * 0.8) {
            textoLimpo = textoLimpo.slice(0, lastSpace);
          }
          textoLimpo += `\n\n[TEXTO TRUNCADO. Máximo de ${MAX_CHARS} caracteres atingido.]`;
        }

        resultado = {
          url: request.loadedUrl || request.url,
          titulo,
          conteudo: textoLimpo,
          tamanhoOriginal: bodySize,
          tamanhoExtraido: textoLimpo.length
        };
      },

      failedRequestHandler: async ({ request }, error) => {
        const errMsg = error?.message || 'Erro desconhecido';
        if (errMsg.includes('timeout')) {
          errorMsg = `Timeout: O site demorou demais para responder (>25s).`;
        } else if (errMsg.includes('403')) {
          errorMsg = `Acesso negado (403): O site bloqueou o scraper (proteção anti-bot).`;
        } else if (errMsg.includes('ENOTFOUND')) {
          errorMsg = `Domínio não encontrado. Verifique a URL.`;
        } else {
          errorMsg = `Falha ao acessar a página: ${errMsg}`;
        }
      }
    }, crawleeConfig);

    // Executa o crawler para a URL única
    await crawler.run([safeUrl]);

  } catch (err) {
    errorMsg = `Erro inesperado no Scraper: ${err.message}`;
  } finally {
    // 3. LIMPEZA OBRIGATÓRIA (Storage e Pasta Temp)
    try {
      await purgeDefaultStorages({ onlyPurgeOnce: true });
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.warn('[WebScraper] Falha no cleanup:', cleanupError.message);
    }
  }

  if (errorMsg) return ToolResult.error('SCRAPE_FAILED', errorMsg);
  if (!resultado) return ToolResult.error('NO_CONTENT', 'Nao foi possivel extrair dados da URL informada.');

  return ToolResult.success(resultado);
}

module.exports = {
  buscarPagina
};
