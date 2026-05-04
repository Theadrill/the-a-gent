const { execFile, exec } = require('child_process');
const path = require('path');
const ToolResult = require('../core/toolResult');

const REPO_DIR = path.resolve(process.cwd());

async function gitInit() {
  try {
    await new Promise((resolve, reject) => {
      execFile('git', ['init'], { cwd: REPO_DIR, timeout: 10000 }, (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
    return ToolResult.success({ mensagem: 'Repositorio git iniciado' });
  } catch (error) {
    return ToolResult.error('GIT_INIT_ERROR', `Erro ao iniciar git: ${error.message}`);
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
    return ToolResult.success({ mensagem: 'Arquivos adicionados ao stage' });
  } catch (error) {
    return ToolResult.error('GIT_ADD_ERROR', `Erro no git add: ${error.message}`);
  }
}

async function gitCommit(mensagem) {
  try {
    if (!mensagem || typeof mensagem !== 'string') {
      return ToolResult.error('GIT_COMMIT_ERROR', 'Mensagem de commit obrigatoria');
    }
    await new Promise((resolve, reject) => {
      exec(`git commit -m "${mensagem.replace(/"/g, '\\"')}"`, { cwd: REPO_DIR, timeout: 15000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
    return ToolResult.success({ mensagem: `Commit realizado: ${mensagem}` });
  } catch (error) {
    return ToolResult.error('GIT_COMMIT_ERROR', `Erro no git commit: ${error.message}`);
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
    return ToolResult.success({ mensagem: 'Push realizado', detalhes: stdout });
  } catch (error) {
    return ToolResult.error('GIT_PUSH_ERROR', `Erro no git push: ${error.message}`);
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
    return ToolResult.success({ stdout: stdout || '(nenhuma alteracao)' });
  } catch (error) {
    return ToolResult.error('GIT_STATUS_ERROR', `Erro no git status: ${error.message}`);
  }
}

async function gitCommitAndSync(mensagem) {
  try {
    const addResult = await gitAdd([]);
    if (!addResult.success && !addResult.error.message.includes('nothing added')) {
      return addResult;
    }

    let commitResult = await gitCommit(mensagem || 'Commit automatico');
    if (!commitResult.success) {
      if (commitResult.error.message && commitResult.error.message.includes('nothing to commit')) {
        const pushResult = await gitPush();
        if (!pushResult.success) {
          return new ToolResult({
            success: false,
            data: null,
            error: { code: 'GIT_SYNC_ERROR', message: `Nada para commitar. Push: ${pushResult.error.message}` },
            metadata: { immediateReply: true }
          });
        }
        return new ToolResult({
          success: true,
          data: { mensagem: 'Nada novo para commitar. Push realizado.', detalhes: pushResult.data?.detalhes || '' },
          metadata: { immediateReply: true }
        });
      }
      return commitResult;
    }

    const pushResult = await gitPush();
    if (!pushResult.success) {
      return new ToolResult({
        success: false,
        data: null,
        error: { code: 'GIT_SYNC_ERROR', message: `Commit feito, mas push falhou: ${pushResult.error.message}` },
        metadata: { immediateReply: true }
      });
    }

    return new ToolResult({
      success: true,
      data: { mensagem: `Commit e push realizados com sucesso: ${mensagem || 'Commit automatico'}`, detalhes: pushResult.data?.detalhes || '' },
      metadata: { immediateReply: true }
    });
  } catch (error) {
    return ToolResult.error('GIT_SYNC_ERROR', `Erro no git commit and sync: ${error.message}`);
  }
}

module.exports = { gitInit, gitAdd, gitCommit, gitPush, gitStatus, gitCommitAndSync };
