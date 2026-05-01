const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../../config.json');
const { ToolResult } = require('../utils/ToolResult');

const isWin = os.platform() === 'win32';
const workdir = path.resolve(config.seguranca.workdir || process.cwd());

function toctouValidate(caminho) {
  try {
    let real;
    try {
      real = fs.realpathSync(caminho, { throwIfNoEntry: false });
    } catch (e) {
      if (e.code === 'ENOENT') {
        return { valid: true, reason: null };
      }
      throw e;
    }
    if (real !== null && real !== undefined) {
      if (!real.startsWith(workdir)) {
        return { valid: false, reason: 'TOCTOU: caminho real do arquivo mudou e agora esta fora do workdir' };
      }
    }

    if (isWin) {
      try {
        const fd = fs.openSync(caminho, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        fs.closeSync(fd);
      } catch (openErr) {
        if (openErr.code === 'ELOOP') {
          return { valid: false, reason: 'TOCTOU: arquivo foi substituido por um symlink' };
        }
        if (openErr.code === 'ENOENT') {
          return { valid: true, reason: null };
        }
      }
    }

    return { valid: true, reason: null };
  } catch (e) {
    return { valid: false, reason: `TOCTOU: erro ao validar caminho: ${e.message}` };
  }
}

async function lerArquivo(caminho) {
  try {
    if (typeof caminho !== 'string') {
      return ToolResult.fail('caminho deve ser uma string');
    }

    const toctou = toctouValidate(caminho);
    if (!toctou.valid) {
      return ToolResult.fail(toctou.reason);
    }

    const conteudo = fs.readFileSync(caminho, 'utf-8');
    return ToolResult.ok({ conteudo, caminho, tamanho: conteudo.length });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return ToolResult.fail('Arquivo nao encontrado');
    }
    if (error.code === 'EACCES') {
      return ToolResult.fail('Permissao negada para ler o arquivo');
    }
    return ToolResult.fail(`Erro ao ler arquivo: ${error.message}`);
  }
}

async function escreverArquivo(caminho, conteudo) {
  try {
    if (typeof caminho !== 'string') {
      return ToolResult.fail('caminho deve ser uma string');
    }
    if (typeof conteudo !== 'string') {
      return ToolResult.fail('conteudo deve ser uma string');
    }

    const toctou = toctouValidate(caminho);
    if (!toctou.valid) {
      return ToolResult.fail(toctou.reason);
    }

    const dir = path.dirname(caminho);
    fs.mkdirSync(dir, { recursive: true });

    const tmpPath = caminho + '.tmp.' + Date.now();
    fs.writeFileSync(tmpPath, conteudo, 'utf-8');
    fs.renameSync(tmpPath, caminho);

    return ToolResult.ok({ caminho, tamanho: Buffer.byteLength(conteudo, 'utf-8') });
  } catch (error) {
    if (error.code === 'EACCES') {
      return ToolResult.fail('Permissao negada para escrever o arquivo');
    }
    return ToolResult.fail(`Erro ao escrever arquivo: ${error.message}`);
  } finally {
    try {
      const tmpPath = caminho + '.tmp.';
      const dir = path.dirname(caminho);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (f.startsWith('.tmp.') && f.endsWith('.tmp')) {
            fs.unlinkSync(path.join(dir, f));
          }
        }
      }
    } catch (e) {}
  }
}

async function listarDiretorio(caminho) {
  try {
    if (typeof caminho !== 'string') {
      return ToolResult.fail('caminho deve ser uma string');
    }

    const toctou = toctouValidate(caminho);
    if (!toctou.valid) {
      return ToolResult.fail(toctou.reason);
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

    return ToolResult.ok(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return ToolResult.fail('Diretorio nao encontrado');
    }
    if (error.code === 'EACCES') {
      return ToolResult.fail('Permissao negada para listar o diretorio');
    }
    return ToolResult.fail(`Erro ao listar diretorio: ${error.message}`);
  }
}

async function criarDiretorio(caminho) {
  try {
    if (typeof caminho !== 'string') {
      return ToolResult.fail('caminho deve ser uma string');
    }

    const toctou = toctouValidate(caminho);
    if (!toctou.valid) {
      return ToolResult.fail(toctou.reason);
    }

    fs.mkdirSync(caminho, { recursive: true });
    return ToolResult.ok({ caminho });
  } catch (error) {
    if (error.code === 'EACCES') {
      return ToolResult.fail('Permissao negada para criar diretorio');
    }
    return ToolResult.fail(`Erro ao criar diretorio: ${error.message}`);
  }
}

async function removerArquivo(caminho) {
  try {
    if (typeof caminho !== 'string') {
      return ToolResult.fail('caminho deve ser uma string');
    }

    const toctou = toctouValidate(caminho);
    if (!toctou.valid) {
      return ToolResult.fail(toctou.reason);
    }

    if (!fs.existsSync(caminho)) {
      return ToolResult.fail('Arquivo nao encontrado');
    }

    fs.unlinkSync(caminho);
    return ToolResult.ok({ caminho, removido: true });
  } catch (error) {
    if (error.code === 'EACCES') {
      return ToolResult.fail('Permissao negada para remover arquivo');
    }
    return ToolResult.fail(`Erro ao remover arquivo: ${error.message}`);
  }
}

module.exports = { lerArquivo, escreverArquivo, listarDiretorio, criarDiretorio, removerArquivo };
