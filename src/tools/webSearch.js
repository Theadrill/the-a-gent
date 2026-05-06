/**
 * Arquivo: /src/tools/webSearch.js
 * 
 * PROPÓSITO: Realizar buscas na web via DuckDuckGo (versão HTML estática).
 *            Extrai títulos, snippets e as URLs reais de destino.
 * 
 * ENTRADAS: query (string), maxResults (number)
 * SAÍDAS: { success: boolean, data?: { query, resultados: Array<{titulo, url, snippet}> }, error?: string }
 */

const { PlaywrightCrawler, Configuration, purgeDefaultStorages } = require('crawlee');
const fs = require('fs');
const path = require('path');
const { validateUrl } = require('../core/securityLayer');
const ToolResult = require('../core/toolResult');

// Seletores específicos para o DuckDuckGo HTML (Versão Estática)
// O container principal é #links .result (Bright Data 2025)
const RESULT_SELECTORS = ['#links .result', 'div.result', '.result__body', 'article[data-testid="result"]'];
const TITLE_SELECTOR = '.result__a';
const SNIPPET_SELECTOR = '.result__snippet';

/**
 * Extrai a URL real do link de rastreamento do DuckDuckGo.
 * Formato DDG: //duckduckgo.com/l/?uddg=https%3A%2F%2Fsite.com%2F...
 */
function extractRealUrl(ddgHref) {
  try {
    if (!ddgHref) return null;
    const fullUrl = ddgHref.startsWith('http') ? ddgHref : 'https:' + ddgHref;
    const urlObj = new URL(fullUrl);
    const realUrl = urlObj.searchParams.get('uddg');
    return realUrl ? decodeURIComponent(realUrl) : fullUrl;
  } catch (e) {
    return ddgHref;
  }
}

/**
 * Realiza a pesquisa web e retorna uma lista de resultados.
 */
async function pesquisarWeb(query, maxResults = 3) {
  if (!query) return ToolResult.error('EMPTY_QUERY', 'Query de busca vazia.');
  
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  
  // 1. Defesa SSRF (Validar URL de busca)
  const urlCheck = await validateUrl(searchUrl);
  if (urlCheck.status !== 'allowed') {
    return ToolResult.error('SSRF_BLOCK', `Busca bloqueada por seguranca (SSRF): ${urlCheck.reason}`);
  }

  // 2. Configuração do ambiente
  const tempDir = path.join(process.cwd(), 'temp_workspace', `search_${Date.now()}`);
  process.env.CRAWLEE_STORAGE_DIR = tempDir;

  const crawleeConfig = new Configuration({
    persistStorage: false,
    purgeOnStart: true,
    logLevel: 'OFF',
  });

  let resultadosExtraidos = [];
  let errorMsg = null;

  try {
    const cheerio = require('cheerio');
    
    const crawler = new PlaywrightCrawler({
      minConcurrency: 1,
      maxConcurrency: 1,
      requestHandlerTimeoutSecs: 30,
      navigationTimeoutSecs: 15,
      maxRequestRetries: 1,
      maxRequestsPerCrawl: 1,
      
      browserPoolOptions: {
        useFingerprints: true,
      },
      
      requestHandler: async ({ page }) => {
        await page.waitForLoadState('domcontentloaded');
        const html = await page.content();
        const $ = cheerio.load(html);
        
        // Tenta cada seletor de resultado até encontrar resultados
        let results = null;
        for (const selector of RESULT_SELECTORS) {
          const found = $(selector);
          if (found.length > 0) {
            results = found;
            break;
          }
        }
        
        if (!results || results.length === 0) {
          // Verifica se houve bloqueio ou "sem resultados"
          if ($('.no-results').length > 0) {
            errorMsg = 'Nenhum resultado encontrado para esta consulta.';
          } else {
            errorMsg = 'Falha ao extrair resultados. O DuckDuckGo pode estar bloqueando a requisição ou mudou a estrutura.';
          }
          return;
        }

        results.each((i, el) => {
          if (resultadosExtraidos.length >= Math.min(maxResults, 5)) return false;

          const $el = $(el);
          const titleEl = $el.find(TITLE_SELECTOR).first();
          const snippetEl = $el.find(SNIPPET_SELECTOR).first();
          
          const href = titleEl.attr('href');
          const urlReal = extractRealUrl(href);
          
          if (urlReal && !urlReal.includes('duckduckgo.com/y.js')) {
            resultadosExtraidos.push({
              titulo: titleEl.text().trim() || 'Sem título',
              url: urlReal,
              snippet: snippetEl.text().trim() || '(sem descrição)'
            });
          }
        });
      },

      failedRequestHandler: async ({ request }, error) => {
        const errMsg = error?.message || 'Erro desconhecido';
        errorMsg = `Falha na busca (DDG): ${errMsg}`;
      }
    }, crawleeConfig);

    await crawler.run([searchUrl]);

  } catch (err) {
    errorMsg = `Erro inesperado na Ferramenta de Busca: ${err.message}`;
  } finally {
    // 3. LIMPEZA
    try {
      await purgeDefaultStorages({ onlyPurgeOnce: true });
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.warn('[WebSearch] Falha no cleanup:', cleanupError.message);
    }
  }

  if (errorMsg) return ToolResult.error('SEARCH_FAILED', errorMsg);
  if (resultadosExtraidos.length === 0) return ToolResult.error('NO_RESULTS', 'Nenhum resultado foi extraido da busca.');

  return ToolResult.success({
    query,
    resultados: resultadosExtraidos,
    instrucao: 'Use buscarPagina(url) para ler o conteudo completo de um dos links acima.'
  });
}

module.exports = {
  pesquisarWeb
};
