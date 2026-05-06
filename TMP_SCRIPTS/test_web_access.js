/**
 * Arquivo: TMP_SCRIPTS/test_web_access.js
 *
 * PROPÓSITO: Validar a camada de acesso web (webScraper + webSearch + securityLayer SSRF)
 *            independentemente do WhatsApp e do LLM.
 *
 * COMO EXECUTAR: node TMP_SCRIPTS/test_web_access.js
 *
 * O QUE VALIDA:
 *   1. buscarPagina com URL pública (ex: example.com) → sucesso
 *   2. buscarPagina com URL localhost → bloqueado por SSRF
 *   3. buscarPagina com URL de IP privado → bloqueado por SSRF
 *   4. pesquisarWeb com query simples ("Node.js") → sucesso, retorna resultados
 *   5. pesquisarWeb com query vazia → erro tratado
 *   6. buscarPagina com URL inexistente → erro tratado (ENOTFOUND)
 *   7. buscarPagina com redirect para IP interno → bloqueado por SSRF
 *   8. Conteúdo extraído é sanitizado (sem <script>, <style>, etc.)
 *   9. Limpeza de storage após execução
 */

const { buscarPagina } = require('../src/tools/webScraper');
const { pesquisarWeb } = require('../src/tools/webSearch');
const fs = require('fs');
const path = require('path');

const TEST_CASES = [
  {
    nome: 'buscarPagina: URL pública válida (example.com)',
    fn: () => buscarPagina('https://example.com'),
    esperado: (r) => r.success && r.data.conteudo.length > 0 && r.data.titulo === 'Example Domain',
  },
  {
    nome: 'buscarPagina: localhost (SSRF)',
    fn: () => buscarPagina('http://127.0.0.1:11434/api/generate'),
    esperado: (r) => !r.success && r.error.includes('SSRF'),
  },
  {
    nome: 'buscarPagina: IP privado (SSRF)',
    fn: () => buscarPagina('http://192.168.0.1/'),
    esperado: (r) => !r.success && r.error.includes('SSRF'),
  },
  {
    nome: 'pesquisarWeb: query simples ("Node.js")',
    fn: () => pesquisarWeb('Node.js event loop', 2),
    esperado: (r) => r.success && Array.isArray(r.data?.resultados) && r.data.resultados.length > 0,
  },
  {
    nome: 'buscarPagina: URL inexistente (ENOTFOUND)',
    fn: () => buscarPagina('https://this-domain-definitely-does-not-exist-12345.com'),
    esperado: (r) => !r.success,
  },
  {
    nome: 'buscarPagina: redirect para IP interno (SSRF)',
    fn: () => buscarPagina('http://httpbin.org/redirect-to?url=http://127.0.0.1:8080/admin'),
    esperado: (r) => !r.success && r.error.includes('SSRF'),
  },
  {
    nome: 'pesquisarWeb: query vazia',
    fn: () => pesquisarWeb(''),
    esperado: (r) => !r.success,
  },
  {
    nome: 'buscarPagina: sanitização HTML',
    fn: async () => {
      const r = await buscarPagina('https://example.com');
      if (!r.success) return false;
      // Verifica que conteúdo NÃO contém tags script/style em formato de string
      const temScript = /<script\b/i.test(r.data.conteudo);
      const temStyle = /<style\b/i.test(r.data.conteudo);
      return !temScript && !temStyle;
    },
    esperado: (r) => r === true,
  },
];

async function runTests() {
  console.log('=== INICIANDO TESTES DE ACESSO WEB (FASE 4) ===\n');
  
  let passou = 0, falhou = 0;
  
  for (const caso of TEST_CASES) {
    process.stdout.write(`Rodando: ${caso.nome}... `);
    try {
      const resultado = await caso.fn();
      const ok = caso.esperado(resultado);
      if (ok) {
        console.log('✅ PASSOU');
        passou++;
      } else {
        console.log('❌ FALHOU');
        console.log('   Resultado obtido:', JSON.stringify(resultado).slice(0, 200) + '...');
        falhou++;
      }
    } catch (err) {
      console.log('❌ ERRO');
      console.error('   Exceção:', err.message);
      falhou++;
    }
  }
  
  console.log(`\n=== RESULTADO FINAL: ${passou} passaram, ${falhou} falharam ===`);
  
  // Cleanup final check
  const tempDirBase = path.join(process.cwd(), 'temp_workspace');
  const items = fs.readdirSync(tempDirBase).filter(f => f.startsWith('crawlee_') || f.startsWith('search_'));
  if (items.length > 0) {
    console.log(`⚠️  Aviso: ${items.length} pastas temporárias não foram removidas.`);
  } else {
    console.log('✅ Sucesso: Todas as pastas temporárias foram limpas.');
  }
  
  process.exit(falhou > 0 ? 1 : 0);
}

runTests();
