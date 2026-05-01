const { validateAction } = require('../core/securityLayer');
const { lerArquivo, escreverArquivo, listarDiretorio } = require('./fileSystem');
const { executarComando } = require('./osCommands');
const { ToolResult } = require('../utils/ToolResult');

const toolMap = {
  lerArquivo,
  escreverArquivo,
  listarDiretorio,
  executarComando,
};

const CONFIRMATION_TOOLS = [
  'escreverArquivo', 'criarDiretorio', 'removerArquivo', 'removerDiretorio',
  'instalarPacote', 'executarComando',
];

async function executeToolCall(toolCallRequest) {
  try {
    if (!toolCallRequest || typeof toolCallRequest !== 'object') {
      return ToolResult.fail('toolCallRequest invalido');
    }

    const tool = toolCallRequest.tool;
    const params = toolCallRequest.params || {};

    if (!tool || typeof tool !== 'string') {
      return ToolResult.fail('tool ausente ou invalido em toolCallRequest');
    }

    const validation = await validateAction(tool, params);

    if (validation.status === 'blocked') {
      return ToolResult.fail(`Acao bloqueada: ${validation.reason}`);
    }

    if (validation.status === 'requires_confirmation') {
      return new ToolResult(false, null, `Acao requer confirmacao: ${validation.reason}`, {
        requiresConfirmation: true,
        toolCallRequest: { tool, params: validation.sanitizedParams || params },
      });
    }

    const toolFn = toolMap[tool];
    if (!toolFn) {
      return ToolResult.fail(`Ferramenta desconhecida: ${tool}`);
    }

    const sanitizedParams = validation.sanitizedParams || params;

    let result;
    if (tool === 'executarComando') {
      result = await toolFn(sanitizedParams.comando, sanitizedParams.argumentos);
    } else {
      const paramValues = Object.values(sanitizedParams);
      result = await toolFn(...paramValues);
    }

    return result;
  } catch (error) {
    return ToolResult.fail(`Erro no toolManager: ${error.message}`);
  }
}

module.exports = { executeToolCall };
