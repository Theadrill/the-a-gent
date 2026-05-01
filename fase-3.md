# Plano de Ação - Fase 3: As Mãos (Execução de Sistema e Segurança)

## Objetivo da Fase
Implementar a "Camada DirectX" de abstração do Sistema Operacional. Esta fase conectará o cérebro do agente (Function Calling via JSON) às ferramentas do sistema nativo, permitindo a gestão de arquivos e a execução de comandos no terminal. O foco absoluto será a implementação da Segurança Tri-State, a proteção contra injeção de comandos, path traversal e race conditions.

**Pré-requisito:** Fases 1 e 2 operacionais (LLM via hostname + WhatsApp funcional).

---

## Instruções Críticas para o Agente Codificador

1. **Segurança por Design (execução estrita e imutável):** `child_process.exec` é **proibido**. Use exclusivamente `child_process.execFile`. A diferença é que `exec` concatenaria o comando em uma shell (`cmd.exe` no Windows, `/bin/sh` no Linux), abrindo porta para injeção se a IA gerar algo como `; rm -rf /`. `execFile` executa o binário diretamente com argumentos como array, tornando injeção impossível.

2. **Path Traversal e Canonicalização:** Use `fs.realpathSync` com `throwIfNoEntry: false` para resolver links simbólicos antes de verificar o workdir. Um symlink dentro do workdir apontando para `/etc/passwd` burlaria `startsWith(workdir)` sem essa verificação.

3. **TOCTOU (Time-of-check Time-of-use):** Entre a validação no `securityLayer` e a execução na tool, um processo concorrente pode substituir o arquivo por um symlink malicioso. Cada tool deve **revalidar** o `realpath` no momento da operação e rejeitar se o caminho real mudou.

4. **Race Condition em Operações de Arquivo:** Operações de escrita usam `.tmp` + `rename` (escrita atômica) como já feito em `fileHandler.js`.

5. **Rede Dinâmica:** Todas as conexões (LLM, Webhooks futuros) usam hostname, nunca IP fixo. A configuração está em `config.api.hostname`.

6. **Explicação Didática:** Todo código deve vir com comentários arquiteturais explicando **por que** cada bloco existe, não apenas **o que** faz.

7. **SRP (Responsabilidade Única):** Cada ferramenta é um arquivo em `/src/tools` (250-500 linhas). Responsabilidades secundárias vão para `/src/utils`.

8. **Versionamento:** Proibido commit/push automáticos.

---

## Roteiro de Execução (Passo a Passo)

### Passo 1: O Guarda-Costas — Camada de Segurança Tri-State
**Ação:** Criar o módulo que audita toda ação antes dela atingir o SO.

**Arquivos:**
- `/src/core/securityLayer.js` — exporta `{ validateAction }`

#### Contrato Canônico
```javascript
async function validateAction(toolName, params) -> Promise<{
  status: 'allowed' | 'blocked' | 'requires_confirmation',
  reason: string | null,
  sanitizedParams: object | null  // params com caminhos resolvidos e validados
}>
```

#### Lógica Interna

1. **Recebe `toolName` (string) e `params` (objeto)**.
   - Ex: `{ tool: 'lerArquivo', params: { caminho: './package.json' } }`.

2. **Blacklist de comandos (sem I/O):**
   - `BLOCKED_COMMANDS = ['rm', 'del', 'rd', 'format', 'shutdown', 'reg', 'schtasks', 'sudo', 'chmod', 'chown', 'dd', 'mkfs', 'cmd', 'powershell', 'wmic']`
   - Se `toolName === 'executarComando'` e `params.comando` em `BLOCKED_COMMANDS`, retorna `blocked`.

3. **Blacklist de diretórios:**
   - `BLOCKED_PATHS`: Windows → `['C:\\Windows', 'C:\\Program Files', 'C:\\System32']`; Linux → `['/etc', '/boot', '/dev', '/proc', '/sys', '/root', '/var/log']`.
   - Case-insensitive no Windows.

4. **Validação de caminho (ferramentas de fileSystem):**
   - Para cada chave em `CAMINHO_KEYS` por tool (ex: `lerArquivo → ['caminho']`):
     a. `const resolved = path.resolve(workdir, caminho)` — normaliza `../../etc/passwd`.
     b. `if (!resolved.startsWith(workdirNormalized))` → `blocked`.
     c. **Symlink check:** `const real = fs.realpathSync(resolved, { throwIfNoEntry: false }); if (real && !real.startsWith(workdirNormalized))` → `blocked`.
     d. **Sanitizar:** `params[caminhoKey] = resolved`.

5. **Zona de Confirmação:**
   - `CONFIRMATION_TOOLS = ['escreverArquivo', 'criarDiretorio', 'removerArquivo', 'removerDiretorio', 'instalarPacote', 'executarComando']`
   - Se `config.seguranca.confirmacao_ativa === false`, pular e ir para `allowed`.

6. **Whitelist (fallthrough):** Ações de leitura retornam `allowed`.

#### Ameaças Mitigadas (Explicação Didática)

| Ameaça | Como o Código Bloqueia |
|--------|------------------------|
| `caminho: "../../Windows/System32/cmd.exe"` | `path.resolve` normaliza + `startsWith(workdir)` |
| Symlink → `/etc/passwd` | `fs.realpathSync` no validator + revalidação na tool |
| TOCTOU: trocam o arquivo entre validação e leitura | Tool revalida `realpath` no momento da operação, rejeita se mudou |
| `comando: "rm -rf /"` | `BLOCKED_COMMANDS` antes de `execFile` |
| `execFile` com `cmd /c` + `\|`, `;` no Windows | `cmd` está em `BLOCKED_COMMANDS`. `execFile` é usado direto com `.exe` |
| DoS por stdout gigante | `maxBuffer: 1MB` + truncamento pós-execução |
| Loop infinito de ferramentas da IA | `MAX_TOOL_ITERATIONS = 5` |

---

### Passo 2: O Arsenal de Arquivos — File System Seguro
**Ação:** Construir métodos seguros para leitura/escrita de código com validação de caminho dupla (no securityLayer + na própria tool).

**Arquivo:** `/src/tools/fileSystem.js` — exporta `{ lerArquivo, escreverArquivo, listarDiretorio }`

#### Estrutura do Arquivo
```javascript
const fs = require('fs');
const path = require('path');
const config = require('../../config.json');

const workdir = path.resolve(config.seguranca.workdir || process.cwd());
```

#### `async function lerArquivo(caminho)`
- `caminho` vem sanitizado pelo `securityLayer`, mas **revalidamos** no momento da operação (proteção TOCTOU).
- **Revalidação TOCTOU:** chamar `fs.realpathSync(caminho)` novamente. Se o resultado for diferente do validado (ou seja, o arquivo foi trocado entre a validação e a leitura), retornar erro `'Caminho alterado entre validacao e execucao'`.
- No Windows, usar `fs.open(caminho, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)` para recusar abertura de symlinks. Se falhar com `ELOOP`, rejeitar.
- `try { const conteudo = fs.readFileSync(caminho, 'utf-8'); return { success: true, data: conteudo }; }`
- `catch` → `{ success: false, error: erro.message }`. O erro real é devolvido para a IA tentar corrigir autonomamente.

#### `async function escreverArquivo(caminho, conteudo)`
- Escrita atômica: escreve em `caminho.tmp`, depois `fs.renameSync(tmpPath, caminho)`.
- `fs.mkdirSync(path.dirname(caminho), { recursive: true })`.
- `finally { try { fs.unlinkSync(tmpPath); } catch(e) {} }`.
- Se o conteúdo contiver caracteres não-UTf8, logar aviso (não bloquear).
- Retorna `{ success: true, data: { caminho, tamanho: buffer.length } }`.

#### `async function listarDiretorio(caminho)`
- `fs.readdirSync(caminho, { withFileTypes: true })`.
- Mapeia para `{ nome, tipo, tamanho, modificadoEm }`.

#### Observações de Segurança
- **TOCTOU mitigado por revalidação na tool:** o `securityLayer` valida, a tool revalida no momento da operação. Se o arquivo foi trocado entre os dois momentos, a tool rejeita.
- `O_NOFOLLOW` no Windows impede abertura de symlinks (requer `fs.constants.O_NOFOLLOW`).

---

### Passo 3: O Arsenal de Comandos — OS Terminal Seguro
**Ação:** Abstrair execução de comandos de forma segura.

**Arquivo:** `/src/tools/osCommands.js` — exporta `{ executarComando }`

#### Contrato Canônico
```javascript
async function executarComando(comando, argumentos) -> Promise<{
  success: boolean,
  stdout: string,
  stderr: string,
  codigoSaida: number | null
}>
```

#### Lógica Interna

1. **Validação de `comando`:**
   - `comando` é o binário (ex: `'node'`, `'git'`).
   - `argumentos` é um array de strings (ex: `['-v']`).
   - Verificar blacklist novamente (defesa em profundidade).

2. **Resolução do binário (⚠️ Crítico — sem `cmd /c`):**
   - No Windows, `execFile` aceita `.exe` diretamente se estiver no PATH: `execFile('node', ['-v'])` funciona.
   - **`cmd /c` é proibido** porque reintroduz shell e anula a proteção do `execFile`. Com `cmd /c`, um argumento como `"& del /f C:\\*"` seria interpretado como comando separado.
   - Comandos internos do `cmd` (ex: `dir`, `copy`, `type`, `echo`) são proibidos por não terem `.exe` correspondente. Adicionar `BLOCKED_COMMANDS_SHELL = ['dir', 'copy', 'type', 'echo', 'cd', 'mkdir', 'ren', 'move']`.

3. **Semáforo de execução (proteção contra DoS):**
   - Usar `async-mutex` (ou implementar `Semaphore` simples) com `MAX_CONCURRENT = 3`.
   - Se o semáforo estiver cheio, a chamada aguarda em fila. Isso evita que 10 execuções paralelas consumam 10MB de heap.

4. **Timeout:**
   - `execFile(comando, argumentos, { timeout: 30000, maxBuffer: 1024 * 1024 })`.

5. **Retorno:**
   ```javascript
   return {
     success: codigoSaida === 0,
     stdout: stdout.slice(0, 10000),
     stderr: stderr.slice(0, 5000),
     codigoSaida
   };
   ```

6. **Tratamento de Erro:**
   - `ENOENT` → `'Comando não encontrado no sistema'`.
   - `EACCES` → `'Permissão negada'`.
   - `ETIMEDOUT` → `'Comando excedeu o tempo limite'`.

#### Ameaças Mitigadas

| Abordagem Errada | Abordagem Correta |
|------------------|-------------------|
| `exec('npm install ' + pacote)` | `execFile('npm', ['install', pacote])` |
| `execFile('cmd', ['/c', 'node', '-v'])` com arg malicioso | `execFile('node', ['-v'])` direto sem shell |
| 10 execuções paralelas de `npm install` | Semáforo com max 3 concorrentes |

---

### Passo 4: O Roteador de Ferramentas — Tool Manager
**Ação:** Hub central que recebe o JSON do LLM, valida com securityLayer, executa a ferramenta e retorna o resultado para o loop principal.

**Arquivo:** `/src/tools/toolManager.js` — exporta `{ executeToolCall }`

#### Contrato Canônico
```javascript
async function executeToolCall(toolCallRequest) -> Promise<{
  success: boolean,
  result: any,        // dados da execução ou mensagem de erro
  requiresConfirmation: boolean,
  error: string | null
}>
```

#### Fluxo de Execução

1. **Recebe `toolCallRequest`:** `{ tool: 'lerArquivo', params: { caminho: './package.json' } }`.
2. **Valida com `securityLayer.validateAction(tool, params)`:**
   - Se `blocked` → `{ success: false, error: reason }`.
   - Se `requires_confirmation` → `{ success: false, requiresConfirmation: true, error: reason }`. O `index.js` vai pausar e perguntar ao usuário.
   - Se `allowed` → prossegue.
3. **Roteia para a ferramenta correta:**
   ```javascript
   const toolMap = {
     lerArquivo: fileSystem.lerArquivo,
     escreverArquivo: fileSystem.escreverArquivo,
     listarDiretorio: fileSystem.listarDiretorio,
     executarComando: osCommands.executarComando,
   };
   const toolFn = toolMap[tool];
   if (!toolFn) return { success: false, error: 'Ferramenta desconhecida' };
   return await toolFn(...Object.values(params));
   ```
4. **Retorna resultado cru** para o loop principal. O loop vai anexar no histórico e chamar o LLM novamente.

---

### Passo 5: Integração do Loop de Ação (Raciocínio → Ação → Observação)
**Ação:** Atualizar o `index.js` para suportar múltiplas iterações de ferramenta antes de responder ao usuário.

**Arquivo a modificar:** `index.js`

#### Nova Lógica em `processTextMessage`

1. Após extrair o JSON do LLM (`parseAndValidate`), verificar se existe o campo `acao` (conforme formato atual do System Prompt) OU `tool_call` (formato novo):
   ```javascript
   const toolRequest = parsed.data.tool_call || (
     parsed.data.acao && parsed.data.acao !== null
       ? { tool: parsed.data.acao, params: parsed.data.parametros }
       : null
   );
   ```
   - Isso garante **compatibilidade retroativa** com o formato de resposta da Fase 1.

2. Se `toolRequest` existe:
   a. Chamar `executeToolCall(toolRequest)`.
   b. Se `requiresConfirmation`: salvar o `toolRequest` pendente em uma variável de escopo `pendingToolCall`, enviar mensagem ao usuário "Precisa de permissão para: [descrição]. Confirma? (sim/não)", e **return** (parar o fluxo).
   c. Se a resposta do usuário for "sim" no `processTextMessage` subsequente e houver `pendingToolCall`:
      ```javascript
      if (pendingToolCall && /^(sim|s|yes|confirmar)$/i.test(text)) {
        const result = await executeToolCall(pendingToolCall);
        pendingToolCall = null;
        // reprocessa com o resultado
        await salvarMensagem({ role: 'system', content: formatToolResult(result) });
        // chama LLM novamente para gerar resposta final
        return await processTextMessage(sock, sender, '[Continuação automática]', msg);
      }
      ```
   d. Se `success`: salvar no banco com `role: 'system'` (ou `role: 'tool'`), chamar LLM novamente com o resultado anexado ao histórico.
   e. Se `!success`: salvar o erro, chamar LLM novamente para que ela tente corrigir.

3. **Loop seguro (max 5 iterações):**
   ```javascript
   let iterations = 0;
   const MAX_TOOL_ITERATIONS = 5;
   // ... dentro do loop
   if (++iterations >= MAX_TOOL_ITERATIONS) break;
   ```
   - Sem isso, a IA poderia entrar em loop infinito de chamadas de ferramenta.

4. **Timeout por iteração:** Usar `AbortSignal.timeout(30000)` em cada chamada ao LLM durante o loop de ferramenta.

#### Observações de Arquitetura (Explicação Didática)
- O loop de múltiplas iterações é necessário porque a IA pode precisar de várias ferramentas para cumprir um comando.
- O `pendingToolCall` deve ser persistido no SQLite (tabela `pending_actions`) associado ao `sender`, com TTL de 5 minutos. Isso evita que um restart do servidor perca a confirmação pendente.
- Se o usuário mandar "sim" e não houver `pendingToolCall`, o sistema responde "Nenhuma ação pendente para confirmar."

#### Utilitário: `formatToolResult(result)` em `/src/utils/toolFormatter.js`
- Converte o resultado de uma tool em string formatada para o histórico do LLM:
```javascript
function formatToolResult(result) {
  if (!result.success) {
    return `[FERRAMENTA: ${result.tool || 'desconhecida'}]\nERRO: ${result.error || result.data?.stderr || 'Falha sem mensagem'}`;
  }
  let output = `[FERRAMENTA: ${result.tool}]\n`;
  if (result.data?.stdout) output += `STDOUT:\n${result.data.stdout}\n`;
  if (result.data?.stderr) output += `STDERR:\n${result.data.stderr}\n`;
  if (result.data?.conteudo) output += `CONTEUDO:\n${result.data.conteudo.slice(0, 2000)}\n`;
  if (result.metadata?.exitCode !== undefined) output += `\nExit code: ${result.metadata.exitCode}`;
  return output;
}
```

---

### Passo 6: Validação Isolada — Script de Teste de Ferramentas
**Ação:** Script para testar a execução de sistema sem Baileys ou Ollama.

**Arquivo:** `/TMP_SCRIPTS/test_system_execution.js`

#### Cabeçalho Obrigatório
```javascript
/**
 * TMP_SCRIPTS/test_system_execution.js
 *
 * PROPÓSITO: Validar a camada de execução do sistema (toolManager + securityLayer)
 *            independentemente do WhatsApp e do LLM.
 *
 * COMO EXECUTAR: node TMP_SCRIPTS/test_system_execution.js
 *
 * O QUE VALIDA:
 *   1. Ferramenta lerArquivo com caminho dentro do workdir → sucesso
 *   2. Ferramenta lerArquivo com path traversal (../../etc/passwd) → bloqueado
 *   3. Ferramenta executarComando com 'node -v' → sucesso
 *   4. Ferramenta executarComando com 'rm -rf' → bloqueado
 *   5. Ferramenta escreverArquivo → requires_confirmation
 *   6. Symlink simulation → bloqueado se escapar do workdir
 */
```

#### Lógica do Script
```javascript
const { executeToolCall } = require('../src/tools/toolManager');

const testCases = [
  { tool: 'lerArquivo', params: { caminho: './package.json' }, expect: 'allowed' },
  { tool: 'lerArquivo', params: { caminho: '../../etc/passwd' }, expect: 'blocked' },
  { tool: 'executarComando', params: { comando: 'node', argumentos: ['-v'] }, expect: 'allowed' },
  { tool: 'executarComando', params: { comando: 'rm', argumentos: ['-rf', '/'] }, expect: 'blocked' },
  { tool: 'escreverArquivo', params: { caminho: './test.txt', conteudo: 'teste' }, expect: 'requires_confirmation' },
];

(async () => {
  let passou = 0, falhou = 0;
  for (const caso of testCases) {
    const result = await executeToolCall({ tool: caso.tool, params: caso.params });
    const status = result.requiresConfirmation ? 'requires_confirmation' : (result.success ? 'allowed' : 'blocked');
    const ok = status === caso.expect;
    console.log(`${ok ? '✅' : '❌'} ${caso.tool}(${JSON.stringify(caso.params)}) → ${status} ${ok ? '' : `(esperado: ${caso.expect})`}`);
    if (ok) passou++; else falhou++;
  }
  console.log(`\n${passou}/${testCases.length} passaram, ${falhou} falharam`);
  process.exit(falhou > 0 ? 1 : 0);
})();
```

---

## Contratos de Exportação (Fase 3)

| Módulo | Exportação | Arquivo |
|--------|-----------|---------|
| securityLayer | `{ validateAction }` | `/src/core/securityLayer.js` |
| fileSystem | `{ lerArquivo, escreverArquivo, listarDiretorio }` | `/src/tools/fileSystem.js` |
| osCommands | `{ executarComando }` | `/src/tools/osCommands.js` |
| toolManager | `{ executeToolCall }` | `/src/tools/toolManager.js` |

---

## CHECKLIST OBRIGATÓRIO DE ARQUITETURA

- [ ] `child_process.exec` é **proibido**. Todo terminal usa `child_process.execFile`.
- [ ] `securityLayer.validateAction` resolve caminhos com `path.resolve` antes de verificar `startsWith(workdir)`.
- [ ] `securityLayer.validateAction` usa `fs.realpathSync` para detectar symlinks que escapam do workdir.
- [ ] `BLOCKED_COMMANDS` inclui `rm`, `del`, `rd`, `format`, `shutdown`, `sudo`, `chmod`, `chown`, `dd`, `mkfs`, `cmd`, `powershell`, `wmic`.
- [ ] `BLOCKED_COMMANDS_SHELL` inclui `dir`, `copy`, `type`, `echo`, `cd`, `mkdir`, `ren`, `move` (comandos internos do `cmd`).
- [ ] `BLOCKED_PATHS` cobre ambos os sistemas: `C:\Windows`, `/etc`, `/boot`, `/dev`, `/proc`, `/sys`.
- [ ] **`cmd /c` é proibido.** No Windows, `execFile` é usado diretamente com `.exe`. Comandos shell internos são bloqueados.
- [ ] TOCTOU mitigado: cada tool revalida `realpath` no momento da operação. Se mudou, rejeita.
- [ ] `escreverArquivo` usa escrita atômica (`.tmp` + `rename`) com limpeza no `finally`.
- [ ] `executarComando` trunca stdout em 10KB e stderr em 5KB.
- [ ] `executarComando` tem semáforo com `MAX_CONCURRENT = 3`.
- [ ] Loop de ação tem `MAX_TOOL_ITERATIONS = 5`.
- [ ] `pendingToolCall` é persistido no SQLite com TTL de 5 min, associado ao `sender`.
- [ ] Timeouts por ferramenta: `lerArquivo: 10s`, `escreverArquivo: 15s`, `listarDiretorio: 5s`, `executarComando: 60s`.
- [ ] `formatToolResult` em `/src/utils/toolFormatter.js` converte resultado em string para o histórico.
- [ ] Script de teste em `TMP_SCRIPTS` cobre: path traversal, comando bloqueado, sucesso, confirmação e symlink real.
- [ ] Todas as funções async expostas têm `try/catch` interno — nenhuma exceção crua escapa.

---

**Status de Conclusão:** A Fase 3 estará concluída quando o usuário enviar pelo WhatsApp "Crie um arquivo teste.txt com a palavra Olá na minha área de trabalho". O Node.js deve: chamar o LLM → extrair `tool_call` → passar pelo securityLayer → pedir confirmação no WhatsApp → usuário confirmar → escrever o arquivo → responder "Arquivo criado com sucesso" no WhatsApp.
