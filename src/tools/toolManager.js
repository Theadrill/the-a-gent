const { validateAction } = require('../core/securityLayer');
const { lerArquivo, escreverArquivo, listarDiretorio, criarDiretorio, removerArquivo } = require('./fileSystem');
const { executarComando } = require('./osCommands');
const { gitInit, gitAdd, gitCommit, gitPush, gitStatus, gitCommitAndSync } = require('./gitCommands');
const { reiniciarAgente } = require('./systemCommands');
const { ToolResult } = require('../utils/ToolResult');

const toolAlias = {
  criar_arquivo: 'escreverArquivo',
  criar_pasta: 'criarDiretorio',
  deletar_arquivo: 'removerArquivo',
  deletar_pasta: 'removerDiretorio',
  apagar_arquivo: 'removerArquivo',
  excluir_arquivo: 'removerArquivo',
  listar_pasta: 'listarDiretorio',
  ler_arquivo: 'lerArquivo',
  executar: 'executarComando',
  git_commit: 'gitCommitAndSync',
  git_push: 'gitCommitAndSync',
  git_sync: 'gitCommitAndSync',
  git_status: 'gitStatus',
  git_add: 'gitAdd',
  git_init: 'gitInit',
};

const toolMap = {
  lerArquivo,
  escreverArquivo,
  listarDiretorio,
  criarDiretorio,
  removerArquivo,
  executarComando,
  gitInit,
  gitAdd,
  gitCommit,
  gitPush,
  gitStatus,
  gitCommitAndSync,
  reiniciarAgente,
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

    let tool = toolCallRequest.tool;
    const params = toolCallRequest.params || {};
    const skipConfirmation = toolCallRequest.skipConfirmation === true;

    if (!tool || typeof tool !== 'string') {
      return ToolResult.fail('tool ausente ou invalido em toolCallRequest');
    }

    tool = toolAlias[tool] || tool;

    const validation = await validateAction(tool, params);

    if (validation.status === 'blocked') {
      return ToolResult.fail(`Acao bloqueada: ${validation.reason}`);
    }

    if (validation.status === 'requires_confirmation' && !skipConfirmation) {
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
