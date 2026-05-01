const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../../config.json');

const isWin = os.platform() === 'win32';

const workdir = path.resolve(config.seguranca.workdir || process.cwd());
const workdirNormalized = path.normalize(workdir);

const BLOCKED_COMMANDS = [
  'rm', 'del', 'rd', 'format', 'shutdown', 'reg', 'schtasks',
  'sudo', 'chmod', 'chown', 'dd', 'mkfs', 'fdisk', 'mount',
  'cmd', 'powershell', 'pwsh', 'wmic', 'msiexec', 'regedit',
  'taskkill', 'tasklist', 'net', 'sc', 'bcdedit', 'diskpart',
];

const BLOCKED_COMMANDS_SHELL = [
  'dir', 'copy', 'type', 'echo', 'cd', 'ren', 'move', 'cls',
  'pause', 'help', 'assoc', 'fc', 'find', 'more', 'sort',
];

const BLOCKED_PATHS = isWin
  ? ['C:\\Windows', 'C:\\Program Files', 'C:\\System32', 'C:\\Boot']
  : ['/etc', '/boot', '/dev', '/proc', '/sys', '/root', '/var/log'];

const CONFIRMATION_TOOLS = [
  'escreverArquivo', 'criarDiretorio', 'removerArquivo', 'removerDiretorio',
  'instalarPacote', 'executarComando',
];

const CAMINHO_KEYS = {
  lerArquivo: ['caminho'],
  escreverArquivo: ['caminho'],
  listarDiretorio: ['caminho'],
  criarDiretorio: ['caminho'],
  removerArquivo: ['caminho'],
  removerDiretorio: ['caminho'],
};

function isPathBlocked(resolvedPath) {
  const normalized = path.normalize(resolvedPath);
  for (const blocked of BLOCKED_PATHS) {
    const blockedNorm = path.normalize(blocked);
    if (isWin) {
      if (normalized.toLowerCase().startsWith(blockedNorm.toLowerCase())) return true;
    } else {
      if (normalized.startsWith(blockedNorm)) return true;
    }
  }
  return false;
}

function resolveAndValidatePath(inputPath, caminhoKeys) {
  const sanitized = {};

  for (const key of caminhoKeys) {
    const raw = inputPath[key];
    if (typeof raw !== 'string') continue;

    const resolved = path.resolve(workdir, raw);
    const resolvedNorm = path.normalize(resolved);

    if (!resolvedNorm.startsWith(workdirNormalized)) {
      return { status: 'blocked', reason: `Path traversal detectado: ${raw} resolve para fora do workdir` };
    }

    if (isPathBlocked(resolvedNorm)) {
      return { status: 'blocked', reason: `Caminho bloqueado: ${resolvedNorm} esta na blacklist` };
    }

    try {
      const real = fs.realpathSync(resolvedNorm, { throwIfNoEntry: false });
      if (real !== null && real !== undefined) {
        if (!real.startsWith(workdirNormalized)) {
          return { status: 'blocked', reason: `Symlink detectado: ${resolvedNorm} aponta para ${real} (fora do workdir)` };
        }
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
      } else {
        return { status: 'blocked', reason: `Erro ao resolver caminho real: ${e.message}` };
      }
    }

    sanitized[key] = resolvedNorm;
  }

  return { status: 'allowed', sanitized };
}

async function validateAction(toolName, params) {
  try {
    if (!toolName || typeof toolName !== 'string') {
      return { status: 'blocked', reason: 'toolName invalido ou ausente' };
    }
    if (!params || typeof params !== 'object') {
      return { status: 'blocked', reason: 'params invalido ou ausente' };
    }

    if (toolName === 'executarComando') {
      const comando = String(params.comando || '').toLowerCase().trim();

      if (BLOCKED_COMMANDS.includes(comando)) {
        return { status: 'blocked', reason: `Comando bloqueado pela blacklist: ${comando}` };
      }

      if (BLOCKED_COMMANDS_SHELL.includes(comando)) {
        return { status: 'blocked', reason: `Comando interno do shell bloqueado: ${comando}. Use o executavel direto (ex: node, git, npm).` };
      }

      if (isWin && comando.endsWith('.exe') && BLOCKED_COMMANDS.includes(comando.replace('.exe', ''))) {
        return { status: 'blocked', reason: `Comando bloqueado pela blacklist: ${comando}` };
      }
    }

    if (toolName in CAMINHO_KEYS) {
      const pathResult = resolveAndValidatePath(params, CAMINHO_KEYS[toolName]);
      if (pathResult.status === 'blocked') {
        return { status: 'blocked', reason: pathResult.reason };
      }
      Object.assign(params, pathResult.sanitized);
    }

    if (toolName === 'executarComando') {
      const comando = String(params.comando || '').toLowerCase().trim();
      const readOnlyCommands = ['node', 'git', 'npm', 'npx', 'python', 'deno', 'bun', 'cat', 'head', 'tail', 'which', 'where', 'pwd', 'ls'];
      if (readOnlyCommands.includes(comando) || comando.endsWith('.exe') && readOnlyCommands.includes(comando.replace('.exe', ''))) {
      } else if (CONFIRMATION_TOOLS.includes(toolName) && config.seguranca.confirmacao_ativa !== false) {
        return { status: 'requires_confirmation', reason: `Acao requer confirmacao: ${toolName} (${comando})`, sanitizedParams: params };
      }
    } else if (CONFIRMATION_TOOLS.includes(toolName) && config.seguranca.confirmacao_ativa !== false) {
      return { status: 'requires_confirmation', reason: `Acao requer confirmacao: ${toolName}`, sanitizedParams: params };
    }

    return { status: 'allowed', sanitizedParams: params, reason: null };
  } catch (error) {
    return { status: 'blocked', reason: `Erro interno na validacao: ${error.message}` };
  }
}

module.exports = { validateAction };
