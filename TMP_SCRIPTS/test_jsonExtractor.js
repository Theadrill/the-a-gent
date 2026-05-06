/*
 * test_jsonExtractor.js
 * Propósito: Teste do módulo jsonExtractor.js
 * Descrição: Valida a função extractJson() com diferentes cenários de entrada
 *            (JSON válido, JSON com texto extra, JSON malformado, resposta vazia)
 * Como executar: a partir da raiz do projeto execute `node TMP_SCRIPTS/test_jsonExtractor.js`
 */

const { extractJson, validateJsonStructure } = require('../src/core/jsonExtractor');

// Casos de teste
const testCases = [
  {
    name: 'JSON válido puro',
    input: '{"resposta":"Olá! Eu sou o The A-gent.","acao":null,"parametros":null}',
    expected: { success: true, hasError: false }
  },
  {
    name: 'JSON com texto extra antes',
    input: 'Aqui está a resposta:\n{"resposta":"Olá! Eu sou o The A-gent.","acao":null,"parametros":null}',
    expected: { success: true, hasError: false }
  },
  {
    name: 'JSON com texto extra depois',
    input: '{"resposta":"Olá! Eu sou o The A-gent.","acao":null,"parametros":null}\n\nEspero ter ajudado!',
    expected: { success: true, hasError: false }
  },
  {
    name: 'JSON com texto extra antes e depois',
    input: 'Resposta:\n{"resposta":"Olá! Eu sou o The A-gent.","acao":null,"parametros":null}\n\nFim da resposta.',
    expected: { success: true, hasError: false }
  },
  {
    name: 'Resposta vazia',
    input: '',
    expected: { success: false, hasError: true }
  },
  {
    name: 'Resposta sem JSON',
    input: 'Olá! Eu sou o The A-gent. Aqui está minha resposta.',
    expected: { success: false, hasError: true }
  },
  {
    name: 'JSON malformado (chaves desbalanceadas)',
    input: '{"resposta":"Olá! Eu sou o The A-gent.","acao":null,"parametros":null',
    expected: { success: false, hasError: true }
  },
  {
    name: 'JSON com aspas duplas no conteúdo (necessita escape)',
    input: '{"resposta":"Ele disse: \\"Olá!\\"","acao":null,"parametros":null}',
    expected: { success: true, hasError: false }
  }
];

// Executa os testes
async function runTests() {
  console.log('Iniciando testes do jsonExtractor...\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of testCases) {
    const result = extractJson(testCase.input);
    const structureValidation = result.success ? validateJsonStructure(result.data) : null;
    
    const successMatch = result.success === testCase.expected.success;
    const errorMatch = (result.error !== null) === testCase.expected.hasError;
    
    if (successMatch && errorMatch) {
      console.log(`✓ ${testCase.name}`);
      passed++;
      
      if (result.success && structureValidation) {
        console.log(`  Estrutura válida: ${structureValidation.valid}`);
        if (!structureValidation.valid) {
          console.log(`  Campos ausentes: ${structureValidation.missingFields.join(', ')}`);
        }
      }
    } else {
      console.log(`✗ ${testCase.name}`);
      console.log(`  Esperado: success=${testCase.expected.success}, hasError=${testCase.expected.hasError}`);
      console.log(`  Recebido: success=${result.success}, error=${result.error}`);
      failed++;
    }
  }
  
  console.log(`\nResultados: ${passed} passaram, ${failed} falharam`);
  
  if (failed > 0) {
    process.exitCode = 1;
  }
}

runTests();