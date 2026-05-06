/**
 * toolResult.js
 * 
 * Classe padronizada para retorno de ferramentas do sistema.
 * Garante consistência no contrato entre as tools e o orquestrador/IA.
 * 
 * Decisão de Segurança: Ter um contrato fixo impede que erros "vazem" 
 * informações sensíveis do sistema de forma desordenada e facilita o 
 * truncamento de dados para evitar DoS por tokens.
 */
class ToolResult {
  constructor({ success, data = null, error = null, metadata = {} }) {
    this.success = success;
    this.data = data; // Resultado útil (string, object, etc)
    this.error = error ? {
      code: error.code || 'UNKNOWN_ERROR',
      message: error.message || 'Erro desconhecido',
      systemCode: error.systemCode || null // Código nativo do SO (ex: ENOENT)
    } : null;
    this.metadata = {
      timestamp: Date.now(),
      ...metadata
    };
  }

  static success(data, metadata = {}) {
    return new ToolResult({ success: true, data, metadata });
  }

  static error(code, message, systemCode = null, metadata = {}) {
    return new ToolResult({ success: false, error: { code, message, systemCode }, metadata });
  }
}

module.exports = ToolResult;
