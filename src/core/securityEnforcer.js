/**
 * securityEnforcer.js
 * 
 * Gerenciador de política de segurança (Tri-State).
 * Orquestra a validação e gerencia o estado de confirmações pendentes no SQLite.
 * 
 * Decisão de Segurança: A separação entre VALIDADOR (puro) e ENFORCER (com estado)
 * permite testar a lógica de regras sem precisar de um banco de dados, enquanto
 * o enforcer garante que ações perigosas sejam PERSISTIDAS no SQLite para
 * evitar que um restart do servidor autorize algo automaticamente.
 */
const { isCommandBlocked, hasShellMetaChars, resolveSafePath } = require('./securityValidator');
const { salvarPendingAction, buscarPendingAction, removerPendingAction } = require('../memory/dbAdapter');
const config = require('../../config.json');

const CONFIRMATION_TOOLS = [
  'escreverArquivo', 'criarDiretorio', 'removerArquivo', 'removerDiretorio', 
  'instalarPacote', 'executarComando'
];

/**
 * Valida uma intenção de ação do LLM.
 * Retorna: { status: 'allowed' | 'blocked' | 'requires_confirmation', reason, sanitizedParams }
 */
async function validateAction(sender, toolName, params) {
  try {
    // 1. Bloqueio de Comandos
    if (toolName === 'executarComando') {
      if (isCommandBlocked(params.comando)) {
        return { 
          status: 'blocked', 
          reason: `O comando '${params.comando}' é proibido por segurança.` 
        };
      }
      if (hasShellMetaChars(params.argumentos)) {
        return { 
          status: 'blocked', 
          reason: 'Argumentos contêm caracteres proibidos (metacaracteres de shell).' 
        };
      }
    }

    // 2. Validação de Caminhos
    // Algumas tools usam 'caminho', outras 'diretorio'. Normalizamos aqui.
    const pathKey = params.caminho ? 'caminho' : (params.diretorio ? 'diretorio' : null);
    
    if (pathKey) {
      const safePath = resolveSafePath(params[pathKey]);
      if (!safePath) {
        return { 
          status: 'blocked', 
          reason: 'Acesso negado: Tentativa de acessar pasta fora do diretório autorizado ou protegida pelo sistema.' 
        };
      }
      params[pathKey] = safePath; // Canonicaliza para o caminho absoluto seguro
    }

    // 3. Checagem de Confirmação (Tri-State)
    // Se limitar_acesso for false, talvez o usuário queira desativar confirmações? 
    // Por segurança, mantemos a confirmação baseada no config.
    const requiresConfirm = CONFIRMATION_TOOLS.includes(toolName) && config.seguranca?.confirmacao_ativa;
    
    if (requiresConfirm) {
      // Salva no SQLite para persistência (TTL de 5 min gerenciado pelo banco/adapter)
      await salvarPendingAction(sender, toolName, params);
      return { 
        status: 'requires_confirmation', 
        reason: `A ação '${toolName}' requer sua aprovação manual.` 
      };
    }

    return { status: 'allowed', sanitizedParams: params };
  } catch (error) {
    console.error('[SecurityEnforcer][ERRO]', error);
    return { status: 'blocked', reason: 'Erro interno na camada de segurança.' };
  }
}

module.exports = {
  validateAction,
  buscarPendingAction,
  removerPendingAction
};
