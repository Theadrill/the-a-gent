const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ToolResult } = require('../utils/ToolResult');

const SCRIPT_DIR = path.resolve(process.cwd());

async function reiniciarAgente() {
  try {
    console.log('[SYSTEM] Reiniciando agente...');

    const restartFlag = path.join(SCRIPT_DIR, '.restart');
    fs.writeFileSync(restartFlag, '', 'utf-8');

    const batPath = path.join(SCRIPT_DIR, 'restart.bat');
    const batContent = `@echo off
cd /d "${SCRIPT_DIR}"
:wait
timeout /t 3 /nobreak >nul 2>&1
npm start
if %errorlevel% neq 0 goto wait
`;
    fs.writeFileSync(batPath, batContent, 'utf-8');

    const child = spawn(batPath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: true,
    });
    child.unref();

    setTimeout(() => {
      try { fs.unlinkSync(batPath); } catch (e) {}
      process.exit(0);
    }, 3000);

    return ToolResult.ok({ mensagem: 'Reiniciando o agente...' });
  } catch (error) {
    return ToolResult.fail(`Erro ao reiniciar: ${error.message}`);
  }
}

module.exports = { reiniciarAgente };
