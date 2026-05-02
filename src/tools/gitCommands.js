const { execFile } = require('child_process');
const path = require('path');
const { ToolResult } = require('../utils/ToolResult');

const REPO_DIR = path.resolve(process.cwd());

async function gitInit() {
  try {
    await new Promise((resolve, reject) => {
      execFile('git', ['init'], { cwd: REPO_DIR, timeout: 10000 }, (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    return ToolResult.ok({ mensagem: 'Repositorio git iniciado' });
  } catch (error) {
    return ToolResult.fail(`Erro ao iniciar git: ${error.message}`);
  }
}

async function gitAdd(arquivos = []) {
  try {
    const args = ['add', ...(arquivos.length > 0 ? arquivos : ['.'])];
    await new Promise((resolve, reject) => {
      execFile('git', args, { cwd: REPO_DIR, timeout: 15000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
    return ToolResult.ok({ mensagem: 'Arquivos adicionados ao stage' });
  } catch (error) {
    return ToolResult.fail(`Erro no git add: ${error.message}`);
  }
}

async function gitCommit(mensagem) {
  try {
    if (!mensagem || typeof mensagem !== 'string') {
      return ToolResult.fail('Mensagem de commit obrigatoria');
    }
    await new Promise((resolve, reject) => {
      execFile('git', ['commit', '-m', mensagem], { cwd: REPO_DIR, timeout: 15000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
    return ToolResult.ok({ mensagem: `Commit realizado: ${mensagem}` });
  } catch (error) {
    return ToolResult.fail(`Erro no git commit: ${error.message}`);
  }
}

async function gitPush() {
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile('git', ['push'], { cwd: REPO_DIR, timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
    return ToolResult.ok({ mensagem: 'Push realizado', detalhes: stdout });
  } catch (error) {
    return ToolResult.fail(`Erro no git push: ${error.message}`);
  }
}

async function gitStatus() {
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile('git', ['status', '--short'], { cwd: REPO_DIR, timeout: 10000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
    return ToolResult.ok({ stdout: stdout || '(nenhuma alteracao)' });
  } catch (error) {
    return ToolResult.fail(`Erro no git status: ${error.message}`);
  }
}

async function gitCommitAndSync(mensagem) {
  try {
    const addResult = await gitAdd([]);
    if (!addResult.success && !addResult.error.includes('nothing added')) {
      return addResult;
    }

    let commitResult = await gitCommit(mensagem || 'Commit automatico');
    if (!commitResult.success) {
      if (commitResult.error && commitResult.error.includes('nothing to commit')) {
        const pushResult = await gitPush();
        if (!pushResult.success) {
          return ToolResult.fail(`Nada para commitar. Push: ${pushResult.error}`);
        }
        return ToolResult.ok({
          mensagem: 'Nada novo para commitar. Push realizado.',
          detalhes: pushResult.data?.detalhes || '',
        });
      }
      return commitResult;
    }

    const pushResult = await gitPush();
    if (!pushResult.success) {
      return ToolResult.fail(`Commit feito, mas push falhou: ${pushResult.error}`);
    }

    return ToolResult.ok({
      mensagem: `Commit e push realizados com sucesso: ${mensagem || 'Commit automatico'}`,
      detalhes: pushResult.data?.detalhes || '',
    });
  } catch (error) {
    return ToolResult.fail(`Erro no git commit and sync: ${error.message}`);
  }
}

module.exports = { gitInit, gitAdd, gitCommit, gitPush, gitStatus, gitCommitAndSync };
