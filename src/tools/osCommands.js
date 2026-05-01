const { execFile } = require('child_process');
const os = require('os');
const { ToolResult } = require('../utils/ToolResult');

const isWin = os.platform() === 'win32';

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

const TIMEOUTS = {
  lerArquivo: 10000,
  escreverArquivo: 15000,
  listarDiretorio: 5000,
  executarComando: 60000,
};

function mapSystemError(error) {
  if (error.code === 'ENOENT') {
    return { message: 'Comando nao encontrado no sistema. Verifique se o programa esta instalado.', systemCode: 'CMD_NOT_FOUND' };
  }
  if (error.code === 'EACCES') {
    return { message: 'Permissao negada. Execute com privilegios adequados.', systemCode: 'PERMISSION_DENIED' };
  }
  if (error.code === 'ETIMEDOUT' || error.code === 'TIMEOUT') {
    return { message: 'Comando excedeu o tempo limite.', systemCode: 'TIMEOUT' };
  }
  return { message: error.message, systemCode: error.code || 'UNKNOWN' };
}

async function executarComando(comando, argumentos = []) {
  if (typeof comando !== 'string' || comando.trim() === '') {
    return ToolResult.fail('comando deve ser uma string nao vazia');
  }

  if (!Array.isArray(argumentos)) {
    return ToolResult.fail('argumentos deve ser um array');
  }

  if (isWin && !comando.endsWith('.exe') && !comando.endsWith('.cmd')) {
    const comExe = comando + '.exe';
    try {
      await new Promise((resolve, reject) => {
        const child = execFile('where', [comando], { timeout: 2000 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (e) {
      return ToolResult.fail(`Comando '${comando}' nao encontrado no PATH. No Windows, use a extensao .exe (ex: node.exe, git.exe)`);
    }
  }

  await acquireSemaphore();

  try {
    const timeoutMs = TIMEOUTS.executarComando;

    const result = await new Promise((resolve, reject) => {
      const child = execFile(comando, argumentos, {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          if (error.code === 'ETIMEDOUT' || error.code === 'TIMEOUT') {
            reject(error);
          } else {
            resolve({
              success: error.code === 0 || (!error.killed && error.code === undefined),
              stdout: stdout || '',
              stderr: stderr || error.message || '',
              codigoSaida: error.code || 1,
            });
          }
        } else {
          resolve({
            success: true,
            stdout: stdout || '',
            stderr: stderr || '',
            codigoSaida: 0,
          });
        }
      });
    });

    const stdoutTruncated = result.stdout.length > 10000
      ? result.stdout.slice(0, 10000) + `\n...[stdout truncado: ${result.stdout.length - 10000} caracteres]`
      : result.stdout;

    const stderrTruncated = result.stderr.length > 5000
      ? result.stderr.slice(0, 5000) + `\n...[stderr truncado: ${result.stderr.length - 5000} caracteres]`
      : result.stderr;

    return ToolResult.ok(
      { stdout: stdoutTruncated, stderr: stderrTruncated },
      { exitCode: result.codigoSaida }
    );
  } catch (error) {
    const mapped = mapSystemError(error);
    return ToolResult.fail(mapped.message, { systemCode: mapped.systemCode });
  } finally {
    releaseSemaphore();
  }
}

module.exports = { executarComando };
