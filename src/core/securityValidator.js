/**
 * securityValidator.js
 * 
 * Funções puras para validação de segurança (Regex e Path).
 * Não gerencia estado, apenas aplica regras matemáticas e lógicas.
 * 
 * Decisão de Segurança: 
 * 1. SHELL_METACHARS: Mesmo usando execFile (que não usa shell), bloqueamos
 *    metacaracteres como barreira extra caso o comando executado (ex: npm)
 *    possa, internamente, interpretar esses caracteres.
 * 2. resolveSafePath: Usa realpathSync para canonicalizar o caminho ANTES
 *    de verificar se começa com o workdir. Isso mata o ataque de Symlink.
 */
const path = require('path');
const fs = require('fs');
const config = require('../../config.json');

// Caracteres proibidos em argumentos para evitar shell escape/injection
const SHELL_METACHARS = /[;&|$\>`\n\r]/;

const BLOCKED_COMMANDS = [
  'rm', 'del', 'rd', 'format', 'shutdown', 'reg', 'schtasks', 
  'sudo', 'chmod', 'chown', 'dd', 'mkfs', 'cmd', 'powershell', 'wmic'
];

const BLOCKED_PATHS = {
  win32: ['C:\\Windows', 'C:\\Program Files', 'C:\\System32'],
  linux: ['/etc', '/boot', '/dev', '/proc', '/sys', '/root', '/var/log']
};

/**
 * Valida se um comando está na lista de bloqueados.
 */
function isCommandBlocked(command) {
  if (typeof command !== 'string') return true;
  const cmd = command.toLowerCase().trim();
  return BLOCKED_COMMANDS.includes(cmd);
}

/**
 * Valida se os argumentos contêm metacaracteres de shell.
 */
function hasShellMetaChars(args) {
  if (!args) return false;
  const toCheck = Array.isArray(args) ? args : [args];
  return toCheck.some(arg => SHELL_METACHARS.test(String(arg)));
}

/**
 * Resolve um caminho de forma segura, prevenindo Path Traversal e validando Symlinks.
 */
function resolveSafePath(userPath) {
  // A opção limitar_acesso: false permite ignorar as travas de diretório
  const isLimited = config.seguranca?.limitar_acesso !== false;
  const workdir = path.resolve(process.cwd(), config.seguranca?.workdir || './');
  
  // Resolve o caminho absoluto (ainda sem lidar com symlinks)
  const resolved = path.resolve(workdir, userPath);

  if (!isLimited) {
    return resolved;
  }

  const workdirNormalized = workdir.toLowerCase();
  
  // 1. Checagem básica de prefixo
  if (!resolved.toLowerCase().startsWith(workdirNormalized)) {
    return null;
  }

  // 2. Checagem de Symlink (Canonicalização)
  // Resolvemos o caminho REAL no disco. Se um symlink no workdir aponta para /etc/passwd,
  // realpathSync retornará /etc/passwd, que NÃO começa com o workdir.
  try {
    const realPath = fs.realpathSync(resolved, { throwIfNoEntry: false });
    if (realPath && !realPath.toLowerCase().startsWith(workdirNormalized)) {
      return null;
    }
  } catch (e) {
    // Erros no realpathSync (ex: path não existe) são tratados como falha de segurança
    // se formos conservadores, ou apenas permitimos se o path.resolve foi OK.
  }

  // 3. Checagem de caminhos sensíveis do SO
  const platform = process.platform === 'win32' ? 'win32' : 'linux';
  const isSensitive = (BLOCKED_PATHS[platform] || []).some(p => 
    resolved.toLowerCase().startsWith(p.toLowerCase())
  );
  
  if (isSensitive) return null;

  return resolved;
}

module.exports = {
  isCommandBlocked,
  hasShellMetaChars,
  resolveSafePath
};
