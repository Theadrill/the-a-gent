/**
 * TMP_SCRIPTS/test_system_execution.js
 *
 * PROPÓSITO: Validar a camada de execução do sistema (toolManager + securityLayer)
 *            independentemente do WhatsApp e do LLM.
 *
 * COMO EXECUTAR: node TMP_SCRIPTS/test_system_execution.js
 *
 * O QUE VALIDA:
 *   1. lerArquivo com caminho dentro do workdir → sucesso
 *   2. lerArquivo com path traversal (../) → bloqueado
 *   3. executarComando com 'node -v' → sucesso
 *   4. executarComando com 'rm -rf' → bloqueado
 *   5. escreverArquivo → requires_confirmation
 *   6. executarComando com comando shell interno (dir/copy) → bloqueado
 *   7. lerArquivo de caminho bloqueado (C:\Windows\System32) → bloqueado
 */

const { executeToolCall } = require('../src/tools/toolManager');

const testCases = [
  { tool: 'lerArquivo', params: { caminho: './package.json' }, expect: 'allowed' },
  { tool: 'lerArquivo', params: { caminho: '../../Windows/System32/cmd.exe' }, expect: 'blocked' },
  { tool: 'executarComando', params: { comando: 'node', argumentos: ['-v'] }, expect: 'allowed' },
  { tool: 'executarComando', params: { comando: 'rm', argumentos: ['-rf', '/'] }, expect: 'blocked' },
  { tool: 'escreverArquivo', params: { caminho: './test.txt', conteudo: 'teste' }, expect: 'requires_confirmation' },
  { tool: 'executarComando', params: { comando: 'dir', argumentos: [] }, expect: 'blocked' },
  { tool: 'lerArquivo', params: { caminho: 'C:/Windows/System32/drivers/etc/hosts' }, expect: 'blocked' },
];

function getStatus(result) {
  if (result.metadata && result.metadata.requiresConfirmation) return 'requires_confirmation';
  if (result.success) return 'allowed';
  return 'blocked';
}

(async () => {
  let passou = 0;
  let falhou = 0;

  for (const caso of testCases) {
    try {
      const result = await executeToolCall({ tool: caso.tool, params: caso.params });
      const status = getStatus(result);
      const ok = status === caso.expect;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${caso.tool}(${JSON.stringify(caso.params)}) => ${status}${ok ? '' : ' (expected: ' + caso.expect + ')'}`);
      if (ok) passou++;
      else {
        falhou++;
        console.log(`       Error: ${result.error || 'none'}`);
      }
    } catch (err) {
      console.log(`FAIL ${caso.tool}(${JSON.stringify(caso.params)}) => exception: ${err.message}`);
      falhou++;
    }
  }

  console.log(`\n${passou}/${testCases.length} passaram, ${falhou} falharam`);
  process.exit(falhou > 0 ? 1 : 0);
})();
