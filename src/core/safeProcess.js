/**
 * safeProcess.js
 * 
 * Wrapper para execução de processos do sistema com controle de tempo e recursos.
 * Previne que o agente trave o Node.js com processos zumbis ou infinitos.
 * 
 * Decisão de Segurança: O uso de AbortController garante que o sinal de parada
 * chegue ao nível do Sistema Operacional. A Promise.race é usada para garantir
 * que o Node.js não fique esperando um processo que parou de responder mas
 * não fechou o pipe de saída.
 */
const { execFile } = require('child_process');

/**
 * Executa uma promise com timeout usando AbortController.
 */
async function asyncWithTimeout(promise, timeoutMs, ac) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      if (ac) ac.abort();
      reject(new Error('TIMEOUT_EXCEEDED'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Wrapper seguro para child_process.execFile.
 * @param {string} command - O executável (sem shell)
 * @param {string[]} args - Array de argumentos
 * @param {object} options - Opções do execFile + timeout
 */
function safeExecFile(command, args, options = {}) {
  const timeout = options.timeout || 30000;
  const ac = new AbortController();
  const { signal } = ac;

  const promise = new Promise((resolve, reject) => {
    // child_process.execFile suporta AbortSignal nativamente no Node moderno
    execFile(command, args, { ...options, signal }, (error, stdout, stderr) => {
      if (error) {
        if (error.name === 'AbortError' || signal.aborted) {
          return reject(new Error('TIMEOUT_EXCEEDED'));
        }
        // Retornamos stdout/stderr mesmo em caso de erro para que a IA 
        // possa analisar mensagens de erro (ex: erro de sintaxe no código)
        return resolve({ 
          success: false, 
          error, 
          stdout: stdout || '', 
          stderr: stderr || '' 
        });
      }
      resolve({ 
        success: true, 
        stdout: stdout || '', 
        stderr: stderr || '' 
      });
    });
  });

  // timeout + 100ms para dar tempo do sinal de aborto ser processado
  return asyncWithTimeout(promise, timeout + 100, ac);
}

module.exports = {
  asyncWithTimeout,
  safeExecFile
};
