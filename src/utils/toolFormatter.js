const ToolResult = require('../core/toolResult');

/**
 * Formata o resultado de uma ferramenta para o histórico do LLM.
 * Garante que a IA entenda o que aconteceu sem se perder em formatos técnicos complexos.
 */
function formatToolResult(toolName, result) {
  if (!(result instanceof ToolResult)) {
    return `[FERRAMENTA: ${toolName || 'desconhecida'}]\nERRO: Resultado inválido da ferramenta (não é uma instância de ToolResult)`;
  }

  if (!result.success) {
    const error = result.error || {};
    let msg = `[FERRAMENTA: ${toolName}]\n❌ ERRO [${error.code || 'UNKNOWN'}]: ${error.message || 'Falha sem mensagem'}`;
    
    if (result.data && result.data.stderr) {
      msg += `\nSTDERR:\n${result.data.stderr}`;
    }
    
    return msg;
  }

  let output = `[FERRAMENTA: ${toolName}]\n✅ SUCESSO\n`;

  const data = result.data || {};

  switch (toolName) {
    case 'lerArquivo':
      if (data.conteudo) {
        output += `CONTEUDO:\n${data.conteudo.slice(0, 5000)}`;
        if (data.conteudo.length > 5000) output += '\n...[CONTEUDO TRUNCADO]';
      }
      break;

    case 'listarDiretorio':
      if (Array.isArray(data)) {
        output += data.map(e => `  ${e.tipo === 'diretorio' ? '[DIR]' : '[FILE]'} ${e.nome}`).join('\n');
      } else {
        output += 'Diretório vazio ou sem conteúdo listável.';
      }
      break;

    case 'executarComando':
      if (data.stdout) output += `STDOUT:\n${data.stdout}\n`;
      if (data.stderr) output += `STDERR:\n${data.stderr}\n`;
      if (result.metadata && result.metadata.exitCode !== undefined) {
        output += `\nExit code: ${result.metadata.exitCode}`;
      }
      break;

    case 'escreverArquivo':
      output += `Arquivo salvo: ${data.caminho} (${data.size || 0} bytes)`;
      break;

    case 'criarDiretorio':
      output += `Diretório criado: ${data.caminho}`;
      break;

    case 'removerArquivo':
      output += `Removido: ${data.caminho}`;
      break;

    default:
      output += JSON.stringify(data, null, 2);
  }

  return output;
}

module.exports = { formatToolResult };
