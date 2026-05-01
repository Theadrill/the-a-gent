const { ToolResult } = require('./ToolResult');

function formatToolResult(toolName, result) {
  if (!(result instanceof ToolResult)) {
    return `[FERRAMENTA: ${toolName || 'desconhecida'}]\nERRO: Resultado invalido`;
  }

  if (!result.success) {
    const errMsg = result.error || (result.data && result.data.stderr) || 'Falha sem mensagem';
    return `[FERRAMENTA: ${toolName}]\nERRO: ${errMsg}`;
  }

  let output = `[FERRAMENTA: ${toolName}]\n`;

  if (toolName === 'lerArquivo' && result.data && result.data.conteudo) {
    output += `CONTEUDO:\n${result.data.conteudo.slice(0, 2000)}`;
    if (result.data.conteudo.length > 2000) output += '\n...[CONTEUDO TRUNCADO]';
  } else if (toolName === 'listarDiretorio' && Array.isArray(result.data)) {
    output += result.data.map(e => `  ${e.tipo === 'diretorio' ? '[DIR]' : '[FILE]'} ${e.nome}`).join('\n');
  } else if (toolName === 'executarComando') {
    if (result.data && result.data.stdout) output += `STDOUT:\n${result.data.stdout}\n`;
    if (result.data && result.data.stderr) output += `STDERR:\n${result.data.stderr}\n`;
    if (result.metadata && result.metadata.exitCode !== undefined) {
      output += `\nExit code: ${result.metadata.exitCode}`;
    }
  } else if (toolName === 'escreverArquivo' && result.data) {
    output += `Arquivo salvo: ${result.data.caminho} (${result.data.tamanho} bytes)`;
  }

  return output;
}

module.exports = { formatToolResult };
