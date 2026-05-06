/**
 * Arquivo: /src/utils/htmlSanitizer.js
 * 
 * PROPÓSITO: Centralizar a lógica de sanitização de HTML e texto extraído.
 *            Evita "token exhaustion" ao remover ruídos estruturais do HTML
 *            antes de enviar o conteúdo para o LLM.
 */

/**
 * Lista exaustiva de seletores CSS que devem ser removidos do HTML
 * antes da extração de texto. Foca em remover scripts, estilos,
 * mídias não-textuais e elementos de navegação/UI.
 */
const REMOVE_SELECTORS = [
  'script', 'style', 'noscript',        // Código e CSS
  'svg', 'canvas', 'video', 'audio',    // Mídia não-textual
  'iframe', 'frame', 'object', 'embed', // Conteúdo embutido
  'img[src^="data:"]',                  // Imagens Base64 embutidas
  'link[rel="stylesheet"]',             // CSS externo
  'meta', 'head',                        // Metadados
  'nav', 'footer', 'header',            // Navegação estrutural
  'form', 'input', 'button', 'select',  // Elementos de formulário
  '[style*="display:none"]',            // Elementos ocultos
  '[style*="display: none"]',           // Variante com espaço
  '[hidden]', '[aria-hidden="true"]',   // Elementos escondidos
  '.sidebar', '.nav', '.menu', '.ad',   // Classes comuns de UI
  '.footer', '.header', '.comment',     // Mais classes comuns
  '#sidebar', '#nav', '#menu',           // IDs comuns de UI
  'template',                            // Templates não renderizados
];

/**
 * Limpa o texto extraído removendo ruídos residuais.
 * 
 * @param {string} rawText - O texto bruto extraído pelo Cheerio.
 * @returns {string} - Texto limpo e formatado.
 */
function cleanExtractedText(rawText) {
  if (!rawText) return '';

  return rawText
    // Remove comentários HTML residuais (<!-- ... -->)
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove sequências de whitespace excessivas (3 ou mais quebras de linha viram 2)
    .replace(/\n{3,}/g, '\n\n')
    // Remove espaços horizontais excessivos
    .replace(/[ \t]{3,}/g, '  ')
    // Remove espaços no início e fim de cada linha
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    // Remove linhas em branco no início/fim do documento
    .trim();
}

module.exports = {
  REMOVE_SELECTORS,
  cleanExtractedText
};
