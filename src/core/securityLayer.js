/**
 * Arquivo: /src/core/securityLayer.js
 * 
 * PROPÓSITO: Camada unificada de segurança e validação.
 *            Responsável por:
 *            1. Proteção SSRF (Server-Side Request Forgery) para ferramentas web.
 *            2. Validação de comandos de sistema e acesso a arquivos (Tri-State).
 *            3. Orquestração de confirmações pendentes via SQLite.
 * 
 * ENTRADAS: URLs, comandos, caminhos de arquivo, nomes de ferramentas e parâmetros.
 * SAÍDAS: Objeto de status { status: 'allowed' | 'blocked' | 'requires_confirmation', reason, sanitizedParams }
 */

const dns = require('dns');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const config = require('../../config.json');

// Dependências de persistência (Fase 3)
const { salvarPendingAction, buscarPendingAction, removerPendingAction } = require('../memory/dbAdapter');
const { isCommandBlocked, hasShellMetaChars, resolveSafePath } = require('./securityValidator');

// --- CONFIGURAÇÕES SSRF ---

// IPv4 Private/Restricted Ranges (RFCs 1918, 1122, 6598, 3927, 5736, 5737, 5771)
const BLOCKED_IPV4_RANGES = [
  { network: '0.0.0.0', prefix: 8, reason: 'Current network (RFC 1122)' },
  { network: '10.0.0.0', prefix: 8, reason: 'Private network (RFC 1918)' },
  { network: '100.64.0.0', prefix: 10, reason: 'Carrier-grade NAT (RFC 6598)' },
  { network: '127.0.0.0', prefix: 8, reason: 'Loopback (RFC 1122)' },
  { network: '169.254.0.0', prefix: 16, reason: 'Link-local (RFC 3927)' },
  { network: '172.16.0.0', prefix: 12, reason: 'Private network (RFC 1918)' },
  { network: '192.0.0.0', prefix: 24, reason: 'IETF Protocol Assignments (RFC 5736)' },
  { network: '192.0.2.0', prefix: 24, reason: 'TEST-NET-1 (RFC 5737)' },
  { network: '192.168.0.0', prefix: 16, reason: 'Private network (RFC 1918)' },
  { network: '198.18.0.0', prefix: 15, reason: 'Network benchmark (RFC 2544)' },
  { network: '198.51.100.0', prefix: 24, reason: 'TEST-NET-2 (RFC 5737)' },
  { network: '203.0.113.0', prefix: 24, reason: 'TEST-NET-3 (RFC 5737)' },
  { network: '224.0.0.0', prefix: 4, reason: 'Multicast (RFC 5771)' },
  { network: '240.0.0.0', prefix: 4, reason: 'Reserved (RFC 1112)' },
];

// IPv6 Private/Restricted Ranges (RFCs 4193, 3849, 6052, 3056)
const BLOCKED_IPV6_RANGES = [
  { network: '::1', prefix: 128, reason: 'Loopback' },
  { network: '::', prefix: 128, reason: 'Unspecified address' },
  { network: 'fe80::', prefix: 10, reason: 'Link-local' },
  { network: 'fc00::', prefix: 7, reason: 'Unique local (RFC 4193)' },
  { network: 'ff00::', prefix: 8, reason: 'Multicast' },
  { network: '2001:db8::', prefix: 32, reason: 'Documentation (RFC 3849)' },
  { network: '::ffff:0:0', prefix: 96, reason: 'IPv4-mapped IPv6' },
  { network: '64:ff9b::', prefix: 96, reason: 'IPv4/IPv6 translation (RFC 6052)' },
  { network: '2002::', prefix: 16, reason: '6to4 (RFC 3056)' },
];

// Hostnames sensíveis que nunca devem ser resolvidos para o agente
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'localhost6',
  'metadata.google.internal',   // GCP
  'instance-data',               // AWS / Azure
  '169.254.169.254',             // Cloud metadata IP
]);

const CONFIRMATION_TOOLS = [
  'escreverArquivo', 'criarDiretorio', 'removerArquivo', 'removerDiretorio', 
  'instalarPacote', 'executarComando'
];

// --- FUNÇÕES UTILITÁRIAS DE IP ---

/**
 * Converte uma string IPv4 para um número inteiro de 32 bits.
 */
function ip4ToInt(ip) {
  return ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
}

/**
 * Converte uma string IPv6 para um BigInt de 128 bits.
 */
function ip6ToBigInt(ip) {
  // Versão simplificada para detecção de ranges básicos
  const fullIp = ip.includes('::') ? expandIPv6(ip) : ip;
  return BigInt('0x' + fullIp.split(':').map(part => part.padStart(4, '0')).join(''));
}

/**
 * Expande uma abreviação IPv6 (::) para a forma completa de 8 grupos.
 */
function expandIPv6(ip) {
  const parts = ip.split('::');
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  const middle = Array(missing).fill('0000');
  return [...left, ...middle, ...right].join(':');
}

/**
 * Verifica se um IP pertence a um determinado range de rede (CIDR).
 */
function isIPv4InRange(ip, network, prefix) {
  const ipInt = ip4ToInt(ip);
  const netInt = ip4ToInt(network);
  const mask = ~(2 ** (32 - prefix) - 1) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

/**
 * Verifica se um IP pertence a um determinado range de rede IPv6 (CIDR).
 */
function isIPv6InRange(ip, network, prefix) {
  const ipBig = ip6ToBigInt(ip);
  const netBig = ip6ToBigInt(network);
  const mask = (BigInt(1) << BigInt(128)) - (BigInt(1) << BigInt(128 - prefix));
  return (ipBig & mask) === (netBig & mask);
}

/**
 * Classifica um IP contra os ranges bloqueados.
 */
function isBlockedIP(ip, family) {
  if (family === 4 || family === 'IPv4') {
    return BLOCKED_IPV4_RANGES.find(range => isIPv4InRange(ip, range.network, range.prefix));
  } else if (family === 6 || family === 'IPv6') {
    return BLOCKED_IPV6_RANGES.find(range => isIPv6InRange(ip, range.network, range.prefix));
  }
  return null;
}

// --- VALIDAÇÃO SSRF ---

/**
 * Valida um hostname/IP contra as regras SSRF.
 * Resolve DNS e verifica ranges de IP.
 */
async function validateHostname(hostname) {
  const lowerHost = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(lowerHost)) {
    return { blocked: true, reason: `Hostname '${lowerHost}' e reservado ou proibido.` };
  }

  const dnsPromise = dns.promises.lookup(hostname, { all: true });
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('DNS_TIMEOUT')), 5000)
  );

  let addresses;
  try {
    addresses = await Promise.race([dnsPromise, timeoutPromise]);
  } catch (e) {
    if (e.message === 'DNS_TIMEOUT') {
      return { blocked: true, reason: 'Timeout na resolucao de DNS.' };
    }
    return { blocked: true, reason: `Falha na resolucao de DNS: ${e.message}` };
  }

  for (const { address, family } of addresses) {
    const block = isBlockedIP(address, family);
    if (block) {
      return { blocked: true, reason: `IP '${address}' pertence a um range restrito (${block.reason}).` };
    }
  }

  return { blocked: false };
}

/**
 * Valida uma URL contra ataques SSRF.
 * Normaliza a URL, resolve DNS, verifica ranges de IP e segue redirects,
 * validando cada destino da cadeia.
 */
async function validateUrl(urlString, maxRedirects = 5) {
  try {
    let currentUrl = urlString;
    let redirectCount = 0;

    while (redirectCount <= maxRedirects) {
      // 1. Normalização via WHATWG URL API
      const url = new URL(currentUrl);

      // Remover credenciais para evitar smuggling
      url.username = '';
      url.password = '';

      // 2. Validar protocolo (Apenas HTTP/HTTPS)
      if (!['http:', 'https:'].includes(url.protocol)) {
        return { status: 'blocked', reason: `Protocolo '${url.protocol}' nao permitido.` };
      }

      const hostname = url.hostname.toLowerCase();

      // 3. Validar hostname contra blacklist estática
      if (BLOCKED_HOSTNAMES.has(hostname)) {
        return { status: 'blocked', reason: `Hostname '${hostname}' e reservado ou proibido.` };
      }

      // 4. Resolver DNS e verificar IP
      const validation = await validateHostname(hostname);
      if (validation.blocked) {
        return { status: 'blocked', reason: validation.reason };
      }

      // 5. Se for a URL final (sem redirect), retornar
      if (redirectCount === 0) {
        // Guardar a URL inicial aprovada para seguir redirects
        currentUrl = url.href;
      }

      // 6. Tentar detectar redirect fazendo uma requisição HEAD
      try {
        const redirectTarget = await followRedirectHead(url.href);
        if (!redirectTarget) {
          // Sem redirect, URL final aprovada
          return { status: 'allowed', sanitizedUrl: url.href };
        }
        // Seguir o redirect
        currentUrl = redirectTarget;
        redirectCount++;
      } catch (e) {
        // Se falhou ao seguir redirect (ex: timeout na requisicao), 
        // ainda permitir a URL original (a validacao de DNS ja passou)
        return { status: 'allowed', sanitizedUrl: url.href };
      }
    }

    return { status: 'blocked', reason: `Muitos redirects (limite: ${maxRedirects}).` };
  } catch (err) {
    return { status: 'blocked', reason: `URL malformada ou invalida: ${err.message}` };
  }
}

/**
 * Faz uma requisicao HEAD para detectar redirects.
 * Retorna a URL de destino do redirect ou null se nao houver redirect.
 */
function followRedirectHead(urlString) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const httpModule = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'HEAD',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    };

    const req = httpModule.request(options, (res) => {
      const statusCode = res.statusCode;
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        const location = res.headers.location;
        if (location) {
          resolve(location);
        } else {
          resolve(null);
        }
      } else {
        resolve(null);
      }
      res.resume();
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// --- VALIDAÇÃO DE AÇÃO (ENFORCER) ---

/**
 * Valida uma acao do LLM baseada em regras de seguranca.
 * Retorna status e parametros sanitizados.
 */
async function validateAction(sender, toolName, params) {
  try {
    // A. FERRAMENTAS WEB (SSRF)
    if (['buscarPagina', 'pesquisarWeb'].includes(toolName)) {
      const urlToValidate = toolName === 'buscarPagina' ? params.url : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query || '')}`;
      
      const urlValidation = await validateUrl(urlToValidate);
      if (urlValidation.status === 'blocked') {
        return { status: 'blocked', reason: `SSRF: ${urlValidation.reason}` };
      }
      
      if (toolName === 'buscarPagina') {
        params.url = urlValidation.sanitizedUrl;
      }
      return { status: 'allowed', sanitizedParams: params };
    }

    // B. COMANDOS DE SISTEMA (Reaproveitado da Fase 3)
    if (toolName === 'executarComando') {
      if (isCommandBlocked(params.comando)) {
        return { status: 'blocked', reason: `O comando '${params.comando}' e proibido.` };
      }
      if (hasShellMetaChars(params.argumentos)) {
        return { status: 'blocked', reason: 'Argumentos contem caracteres de shell proibidos.' };
      }
    }

    // C. ACESSO A ARQUIVOS (Reaproveitado da Fase 3)
    const pathKey = params.caminho ? 'caminho' : (params.diretorio ? 'diretorio' : null);
    if (pathKey) {
      const safePath = resolveSafePath(params[pathKey]);
      if (!safePath) {
        return { status: 'blocked', reason: 'Acesso negado: Tentativa de sair do workspace ou acessar pasta sensivel.' };
      }
      params[pathKey] = safePath;
    }

    // D. CHECAGEM DE CONFIRMAÇÃO (Tri-State)
    const requiresConfirm = CONFIRMATION_TOOLS.includes(toolName) && config.seguranca?.confirmacao_ativa;
    if (requiresConfirm) {
      await salvarPendingAction(sender, toolName, params);
      return { 
        status: 'requires_confirmation', 
        reason: `A acao '${toolName}' requer sua aprovacao manual.` 
      };
    }

    return { status: 'allowed', sanitizedParams: params };
  } catch (error) {
    console.error('[SecurityLayer][ERRO]', error);
    return { status: 'blocked', reason: 'Erro interno na camada de seguranca.' };
  }
}

module.exports = {
  validateUrl,
  validateAction,
  buscarPendingAction,
  removerPendingAction
};
