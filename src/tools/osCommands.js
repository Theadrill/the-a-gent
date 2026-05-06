const ToolResult = require('../core/toolResult');
const { safeExecFile } = require('../core/safeProcess');

const MAX_CONCURRENT = 3;
let activeExecutions = 0;
const executionQueue = [];

function acquireSemaphore() {
  return new Promise((resolve) => {
    if (activeExecutions < MAX_CONCURRENT) {
      activeExecutions++;
      resolve();
    } else {
      executionQueue.push(resolve);
    }
  });
}

function releaseSemaphore() {
  activeExecutions--;
  if (executionQueue.length > 0) {
    const next = executionQueue.shift();
    activeExecutions++;
    next();
  }
}

function mapSystemError(error) {
  if (error.code === 'ENOENT') {
    return { message: 'Comando nao encontrado no sistema. Verifique se o programa esta instalado.', systemCode: 'CMD_NOT_FOUND' };
  }
  if (error.code === 'EACCES') {
    return { message: 'Permissao negada. Execute com privilegios adequados.', systemCode: 'PERMISSION_DENIED' };
  }
  if (error.code === 'ETIMEDOUT' || error.message === 'TIMEOUT_EXCEEDED') {
    return { message: 'Comando excedeu o tempo limite.', systemCode: 'TIMEOUT' };
  }
  return { message: error.message, systemCode: error.code || 'UNKNOWN' };
}

async function executarComando(comando, argumentos = []) {
  if (typeof comando !== 'string' || comando.trim() === '') {
    return ToolResult.error('INVALID_COMMAND', 'comando deve ser uma string nao vazia');
  }

  if (!Array.isArray(argumentos)) {
    argumentos = [argumentos];
  }

  await acquireSemaphore();

  try {
    const result = await safeExecFile(comando, argumentos, {
      timeout: 60000
    });

    if (result.success) {
      const stdoutTruncated = result.stdout.length > 10000
        ? result.stdout.slice(0, 10000) + `\n...[stdout truncado: ${result.stdout.length - 10000} caracteres]`
        : result.stdout;

      const stderrTruncated = result.stderr.length > 5000
        ? result.stderr.slice(0, 5000) + `\n...[stderr truncado: ${result.stderr.length - 5000} caracteres]`
        : result.stderr;

      return ToolResult.success(
        { stdout: stdoutTruncated, stderr: stderrTruncated },
        { exitCode: 0 }
      );
    } else {
      const mapped = mapSystemError(result.error);
      const stdoutTruncated = result.stdout.length > 10000
        ? result.stdout.slice(0, 10000) + `\n...[stdout truncado]`
        : result.stdout;
      const stderrTruncated = result.stderr.length > 5000
        ? result.stderr.slice(0, 5000) + `\n...[stderr truncado]`
        : result.stderr;

      return ToolResult.error(
        'COMMAND_EXECUTION_FAILED',
        mapped.message,
        mapped.systemCode,
        { stdout: stdoutTruncated, stderr: stderrTruncated, exitCode: result.error?.code || 1 }
      );
    }
  } catch (error) {
    if (error.message === 'TIMEOUT_EXCEEDED') {
      return ToolResult.error('TIMEOUT', 'O comando demorou muito para responder e foi interrompido.');
    }
    const mapped = mapSystemError(error);
    return ToolResult.error('EXECUTION_ERROR', mapped.message, mapped.systemCode);
  } finally {
    releaseSemaphore();
  }
}

module.exports = { executarComando };
