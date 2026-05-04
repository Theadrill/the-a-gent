const fs = require('fs');
const path = require('path');
const ToolResult = require('../core/toolResult');

async function lerArquivo(caminho) {
  try {
    if (typeof caminho !== 'string' || caminho.trim() === '') {
      return ToolResult.error('INVALID_PATH', 'caminho deve ser uma string nao vazia');
    }
    const conteudo = fs.readFileSync(caminho, 'utf-8');
    return ToolResult.success({ conteudo, caminho, tamanho: conteudo.length });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return ToolResult.error('NOT_FOUND', 'Arquivo nao encontrado', error.code);
    }
    if (error.code === 'EACCES') {
      return ToolResult.error('PERMISSION_DENIED', 'Permissao negada para ler o arquivo', error.code);
    }
    return ToolResult.error('READ_ERROR', `Erro ao ler arquivo: ${error.message}`, error.code);
  }
}

async function escreverArquivo(caminho, conteudo) {
  const tmpPath = `${caminho}.tmp.${Date.now()}`;
  try {
    if (typeof caminho !== 'string' || caminho.trim() === '') {
      return ToolResult.error('INVALID_PATH', 'caminho deve ser uma string nao vazia');
    }
    if (typeof conteudo !== 'string') {
      return ToolResult.error('INVALID_CONTENT', 'conteudo deve ser uma string');
    }

    const dir = path.dirname(caminho);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(tmpPath, conteudo, 'utf-8');
    fs.renameSync(tmpPath, caminho);

    return ToolResult.success({ caminho, tamanho: Buffer.byteLength(conteudo, 'utf-8') });
  } catch (error) {
    if (error.code === 'EACCES') {
      return ToolResult.error('PERMISSION_DENIED', 'Permissao negada para escrever o arquivo', error.code);
    }
    return ToolResult.error('WRITE_ERROR', `Erro ao escrever arquivo: ${error.message}`, error.code);
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (e) {}
  }
}

async function listarDiretorio(caminho) {
  try {
    if (typeof caminho !== 'string' || caminho.trim() === '') {
      return ToolResult.error('INVALID_PATH', 'caminho deve ser uma string nao vazia');
    }
    const entries = fs.readdirSync(caminho, { withFileTypes: true });
    const data = entries.map(dirent => {
      const fullPath = path.join(caminho, dirent.name);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (e) {
        stat = { size: 0, mtime: new Date(0) };
      }
      return {
        nome: dirent.name,
        tipo: dirent.isDirectory() ? 'diretorio' : 'arquivo',
        tamanho: stat.size,
        modificadoEm: stat.mtime,
      };
    });
    return ToolResult.success(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return ToolResult.error('NOT_FOUND', 'Diretorio nao encontrado', error.code);
    }
    if (error.code === 'EACCES') {
      return ToolResult.error('PERMISSION_DENIED', 'Permissao negada para listar o diretorio', error.code);
    }
    return ToolResult.error('LIST_ERROR', `Erro ao listar diretorio: ${error.message}`, error.code);
  }
}

async function criarDiretorio(caminho) {
  try {
    if (typeof caminho !== 'string' || caminho.trim() === '') {
      return ToolResult.error('INVALID_PATH', 'caminho deve ser uma string nao vazia');
    }
    fs.mkdirSync(caminho, { recursive: true });
    return ToolResult.success({ caminho });
  } catch (error) {
    if (error.code === 'EACCES') {
      return ToolResult.error('PERMISSION_DENIED', 'Permissao negada para criar diretorio', error.code);
    }
    return ToolResult.error('MKDIR_ERROR', `Erro ao criar diretorio: ${error.message}`, error.code);
  }
}

async function removerArquivo(caminho) {
  try {
    if (typeof caminho !== 'string' || caminho.trim() === '') {
      return ToolResult.error('INVALID_PATH', 'caminho deve ser uma string nao vazia');
    }
    if (!fs.existsSync(caminho)) {
      return ToolResult.error('NOT_FOUND', 'Arquivo nao encontrado');
    }
    fs.unlinkSync(caminho);
    return ToolResult.success({ caminho, removido: true });
  } catch (error) {
    if (error.code === 'EACCES') {
      return ToolResult.error('PERMISSION_DENIED', 'Permissao negada para remover arquivo', error.code);
    }
    return ToolResult.error('DELETE_ERROR', `Erro ao remover arquivo: ${error.message}`, error.code);
  }
}

module.exports = { lerArquivo, escreverArquivo, listarDiretorio, criarDiretorio, removerArquivo };
