# Plano de Ação - Fase 2: A Interface (WhatsApp) e Orquestração de Mídia

**Objetivo da Fase:** Conectar o "cérebro" desenvolvido na Fase 1 à interface do WhatsApp utilizando a biblioteca Baileys. Estabelecer a persistência da sessão para evitar re-escaneamento de QR Code e implementar a camada de orquestração para lidar com o recebimento de arquivos, áudios e imagens.

**Pré-requisito:** A Fase 1 deve estar 100% funcional. Os módulos `dbAdapter`, `memoryManager`, `promptBuilder`, `llmClient` e `jsonExtractor` são considerados estáveis e não devem ser modificados nesta fase, apenas consumidos.

---

## Instruções Críticas para o Agente Codificador (Antigravity/IA)

1. **Modularidade (SRP):** Respeite rigorosamente a separação de pastas do `plano_de_projeto.md`. A integração do WhatsApp deve ficar **isolada** em `/src/plugins/whatsapp`. A lógica de roteamento de mídia deve ficar em `/src/orchestrator`. Aplique o *soft limit* de 250 a 500 lines per file.
2. **Scripts de Teste:** Todo e qualquer script de teste isolado gerado nesta fase deve obrigatoriamente ser salvo dentro da pasta `TMP_SCRIPTS` na raiz, contendo um cabeçalho explicativo com propósito, como executar e o que valida.
3. **Explicação de Código:** Jamais despeje código sem contexto. Explique a função de cada bloco, especialmente os "listeners" de eventos do Baileys.
4. **Projeto é `commonjs`:** O `package.json` tem `"type": "commonjs"`. Use `require()` em todos os arquivos. **Não use** `import/export`.
5. **Nunca modificar os módulos da Fase 1** sem instrução explícita.

## REGRA CRÍTICA DE EXECUÇÃO (OBRIGATÓRIA PARA MODELOS FLASH)

Cada função deve seguir obrigatoriamente esta ordem:

1. Imports no topo do arquivo
2. Declaração de constantes
3. Validação de entrada
4. Lógica principal
5. try/catch obrigatório
6. Retorno explícito

⚠️ PROIBIDO:
- Funções async sem try/catch
- Variáveis sem const/let
- Uso de var
- Uso de módulos sem require

**CONTRATOS DE FUNÇÃO CANÔNICOS (OBRIGATÓRIO)**
1. `async function initWhatsApp(onMessageReceived) -> Promise<sock>`
   - `onMessageReceived`: `(sock, messages, type) => void|Promise<void>`
   - O implementador **deve** validar `typeof onMessageReceived === 'function'` antes de usar.
2. `function handleMessage(sock, messages, type, processTextMessage)`
   - `processTextMessage`: `async (sock, sender, text, msg) => Promise<void>`
   - O implementador **deve** validar `typeof processTextMessage === 'function'` antes de chamar.
3. `async function processTextMessage(sock, sender, text, msg) => Promise<void>`
   - Deve marcar como lida defensivamente, enviar presence `composing`, truncar texto, chamar módulos de memória e LLM, e enviar resposta.

> ⚠️ **Todas** as funções `async` expostas (incluindo callbacks passados como argumento) **devem** conter `try/catch` interno. Callbacks sem `try/catch` propagam erros silenciosamente para listeners do Baileys, causando crashes.

---

## Contexto Técnico: Como o Baileys Funciona

Antes de escrever qualquer código, o agente deve entender o modelo mental do Baileys:

- O Baileys cria um **WebSocket** com os servidores do WhatsApp, simulando o WhatsApp Web.
- A sessão é autenticada por **credenciais salvas em disco** (`./auth_info/`). Depois do primeiro QR Code, as credenciais são reutilizadas automaticamente.
- A comunicação é totalmente **orientada a eventos**. O código registra *listeners* (funções callback) nos eventos do socket.
- **Eventos críticos a conhecer:**
  - `connection.update` → status da conexão (QR code gerado, conectado, desconectado).
  - `creds.update` → credenciais atualizadas (deve acionar `saveCreds()` para persistir).
  - `messages.upsert` → novas mensagens recebidas (o evento principal do agente).

---

## Roteiro de Execução (Passo a Passo)

### Passo 1: O Motor do WhatsApp (Conexão e Sessão)

**Ação:** Instalar as dependências e criar o módulo que gerencia o ciclo de vida da conexão com o WhatsApp.

#### 1.1 — Instalar dependências

Execute o seguinte comando na raiz do projeto:

```bash
npm install @whiskeysockets/baileys qrcode-terminal pino
```

- `@whiskeysockets/baileys`: A biblioteca principal do WhatsApp.
- `qrcode-terminal`: Renderiza o QR Code diretamente no terminal para o pareamento inicial.
- `pino`: Logger de alta performance exigido internamente pelo Baileys. Será configurado em modo silencioso para não poluir o console.

> **Recomendação de Versão:** Fixe a versão do Baileys no `package.json` (ex: `"@whiskeysockets/baileys": "6.7.16"`) para evitar quebras por mudanças de API entre releases. Documente as APIs esperadas (`makeWASocket`, `useMultiFileAuthState`, `DisconnectReason`, `downloadMediaMessage`, `downloadContentFromMessage`) e valide após qualquer atualização.

#### 1.2 — Criar `/src/plugins/whatsapp/connection.js`

Este arquivo exporta uma única função assíncrona `initWhatsApp(onMessageReceived)`.

1. Importações e Variáveis (topo do arquivo, antes de qualquer função): 
   ```javascript
   const events = require('events');
   const pino = require('pino');
   const qrcode = require('qrcode-terminal');
   const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
   const socketEmitter = new events.EventEmitter();
   const isConnecting = { value: false };
   ```
   - **Regra:** Módulos nativos (`events`, `pino`) importados como objeto completo. Dependências externas do Baileys desestruturadas (`makeWASocket`, etc.). Módulos locais do projeto (`/src`) devem usar desestruturação: `const { func } = require(...);`.
2. No início de `initWhatsApp`, valide a entrada e defina a trava: 
   ```javascript
   if (typeof onMessageReceived !== 'function') throw new Error('onMessageReceived deve ser uma função');
   if (isConnecting.value) return null; 
   isConnecting.value = true;
   ```
3. Envolva toda a lógica interna em um `try/catch`. 
   - **Gestão de Trava (Política Única — 3 pontos de reset):** Defina `isConnecting.value = true` no início de `initWhatsApp`. **Resetar `isConnecting.value = false` deve ocorrer em três pontos apenas:** (A) no bloco `catch` de falha de boot; (B) imediatamente antes de agendar reconexão no handler `connection.update` quando `connection === 'close'`; (C) imediatamente **antes** do `return sock` em caso de inicialização bem-sucedida. **Não** use `finally` para resetar a trava.
      - **Cuidado com erros assíncronos posteriores:** qualquer listener assíncrono registrado durante a inicialização que lance e interrompa o fluxo de boot deve explicitamente resetar `isConnecting.value = false` no seu próprio `catch` se for abortivo para o boot. A política de 3 pontos só cobre caminhos principais; listeners adicionais podem deixar a trava presa se não tratarem esse reset.
   - **Padrão de Reconexão:** Use exclusivamente `setTimeout` para agendar reconexões. É terminantemente proibido fazer chamadas recursivas diretas (ex: `await initWhatsApp(...)`) dentro do listener para evitar estouro da pilha de chamadas (Stack Overflow).
4. Configure o logger silencioso: `const logger = pino({ level: 'silent' });`

5. Carregue as credenciais com timeout defensivo usando `Promise.race` (ex: timeout de 5000ms):
    - Se o resultado for nulo, estado inválido ou o timeout vencer, capture a falha de forma segura no catch.
    - Em caso de falha, redefina `isConnecting.value = false`, exiba `console.error('[WHATSAPP][ERRO] Auth state inválido ou timeout')` e retorne `null` para abortar a inicialização.
    - Se bem-sucedido, extraia `{ state, saveCreds }`.
    - **Validação extra obrigatória:** verifique explicitamente a forma retornada. Por exemplo:
       ```javascript
       if (!state || !saveCreds || typeof saveCreds !== 'function') {
          isConnecting.value = false;
          console.error('[WHATSAPP][ERRO] Auth state inválido: forma inesperada de retorno');
          return null;
       }
       ```
       Sem essa checagem, objetos parcialmente iniciais podem causar exceções posteriores durante `makeWASocket` ou `saveCreds`.
6. Crie o socket passando `logger` e `auth: state`.
7. Registre o update de credenciais com proteção de tipo: 
   - Ao receber o evento `creds.update`, adicione um bloco `try/catch`.
   - Antes de chamar `saveCreds()`, valide `typeof saveCreds === 'function'`.
   - Se não for função, exiba `console.warn('[WHATSAPP] saveCreds não é uma função')`.
   - Se ocorrer erro, exiba `console.error('[WHATSAPP][ERRO] saveCreds', err)`.
7. Registre o update de credenciais com proteção de tipo: 
    - Ao receber o evento `creds.update`, adicione um bloco `try/catch`.
    - Antes de chamar `saveCreds()`, valide `typeof saveCreds === 'function'`.
    - **Chame `await saveCreds()` explicitamente** dentro do try. Exemplo:
       ```javascript
       sock.ev.on('creds.update', async () => {
          try {
             if (typeof saveCreds === 'function') await saveCreds();
             else console.warn('[WHATSAPP] saveCreds não é uma função');
          } catch (err) {
             console.error('[WHATSAPP][ERRO] saveCreds', err);
          }
       });
       ```
    - Se `await` for omitido implementadores podem perder credenciais por condição de corrida.
8. Registre o listener `connection.update` explicitamente envolvido em um `try/catch`:
   ```javascript
   sock.ev.on('connection.update', async (update) => {
     try {
       // Conteúdo do handler (QR, close, etc.)
     } catch (error) {
       console.error('[WHATSAPP][ERRO] connection.update', error);
     }
   });
   ```
   No corpo do `try`:
   - Imprima o QR code quando disponível: `if (update.qr) qrcode.generate(update.qr, { small: true });`.
   - Quando `connection === 'close'`:
     - Remova listeners defensivamente (`sock.ev.removeAllListeners()`).
     - Extração ultra-defensiva do motivo de desconexão:
        ```javascript
        const lastDisconnect = update.lastDisconnect || {};
        let reasonCode = null;
        try {
          reasonCode = lastDisconnect?.error?.output?.statusCode || 
                       lastDisconnect?.error?.output?.payload?.statusCode || 
                       lastDisconnect?.statusCode || null;
        } catch (e) { reasonCode = null; }
        ```
     - **Reset da Trava (Obrigatório):** Defina `isConnecting.value = false;` imediatamente antes de qualquer `return`.
     - Se o motivo for logout (`reasonCode === DisconnectReason.loggedOut`), exiba `[WHATSAPP] desconectado: loggedOut` no log e retorne.
     - Se o motivo NÃO for logout, agende a reconexão com `setTimeout`. **Atenção:** dentro do callback do `setTimeout`, antes de chamar `initWhatsApp`, verifique se `isConnecting.value` é verdadeiro (se sim, retorne); caso contrário, defina `isConnecting.value = true;` para garantir que múltiplas reconexões não ocorram simultaneamente. Adicione `catch(err => console.error('[WHATSAPP][ERRO] reconectar', err))` na chamada.
9. Se for conectado (open), logar: `console.log('[WHATSAPP] Conectado!');`.

10. Registre o listener `messages.upsert` com validação defensiva e Try/Catch:
      - Use o nome exato `payload` para o parâmetro do listener e a assinatura canônica abaixo **(evita referência a variável inexistente)**:
         ```javascript
         sock.ev.on('messages.upsert', async (payload) => {
            try {
               const messages = Array.isArray(payload?.messages) ? payload.messages : [];
               if (!messages.length) return;
               await onMessageReceived(sock, messages, payload.type);
            } catch (error) {
               console.error('[WHATSAPP][LISTENER ERRO]', error);
            }
         });
         ```
      - Isso previne implementadores que usariam nomes diferentes (`m`/`messageUpdate`) e referenciariam `payload` sem existir.
11. Retorno de Função: No final do sucesso (APÓS registrar todos os listeners):
    - `isConnecting.value = false;` // Ponto (C): reset em caso de sucesso
    - `socketEmitter.emit('socket', sock);`
    - `return sock;`
12. No bloco `catch`:
    - `isConnecting.value = false;` // Ponto (A): reset em caso de falha de startup
    - `console.error('[WHATSAPP][ERRO] init', error);`
    - `return null;`
13. **NÃO inclua bloco `finally`.** O reset da trava ocorre apenas nos três pontos documentados: (A) catch de boot, (B) connection close, (C) return de sucesso.
14. Exportação Final: `module.exports = { initWhatsApp, socketEmitter };`

---

### Passo 2: O Ouvinte de Mensagens (Message Handler)

**Ação:** Criar o filtro inteligente que processa as mensagens recebidas, ignorando ruído (mensagens do próprio bot, grupos, mensagens antigas).

#### 2.1 — Criar `/src/plugins/whatsapp/messageHandler.js`

**No topo do arquivo, coloque obrigatoriamente os seguintes `require`:**
```javascript
const { routeMedia } = require('../../orchestrator/mediaRouter');
```

Este arquivo exporta uma função **assíncrona** `async function handleMessage(sock, messages, type, processTextMessage)` que:

1. Verifique o tipo de atualização: `if (type !== 'notify') return;`.
2. Valide o payload: `if (!Array.isArray(messages)) return;`
3. Percorra as mensagens obrigatoriamente com um loop `for (const msg of messages)`, garantindo que o processamento seja sequencial e respeite os `await`.
      - **Função utilitária de timestamp (normalização explícita):** Declare `getMessageTimestamp(msg)` para extrair o valor e **normalizar para segundos**. Use uma heurística simples: se o número for maior que 1e12, trate como ms e converta para s. Exemplo padrão:
         ```javascript
         function getMessageTimestamp(msg) {
            const raw = msg?.messageTimestamp || msg?.key?.timestamp || msg?.message?.timestamp || 0;
            let ts = Number(raw) || 0;
            // se parece com epoch em ms, converte para segundos
            if (ts > 1e12) ts = Math.floor(ts / 1000);
            return Math.floor(ts);
         }
         ```
      - **Filtro de Mensagens Antigas (60s):** chame `getMessageTimestamp(msg)` e compare com `Math.floor(Date.now() / 1000)`. Verifique `if (!Number.isFinite(messageTimestamp)) continue;` e descarte a mensagem se a diferença for maior que 60 segundos.
4. Extrair o JID com segurança e aplicar filtros de descarte. Dentro do loop for..of, use apenas continue. Proíba o uso de return para garantir que falhas em uma mensagem não interrompam a fila:
   - **Extração Segura do JID:** Extraia a string garantindo o tipo com `const jid = String(msg.key?.remoteJid || '');` antes de checar terminações.
   - Checagem defensiva de JID:
     ```javascript
     if (!msg.key) { console.log('[MESSAGE_HANDLER] mensagem sem key, pulando'); continue; }
     if (msg.key.fromMe === true) continue;
     ```
    - Se for grupo ou status: `if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue;`
    - Se não tiver conteúdo: `if (!msg.message) continue;`
5. Normalização de mensagem:
   ```javascript
   const msgContent =
     msg.message?.ephemeralMessage?.message ||
     msg.message?.viewOnceMessage?.message ||
     msg.message;

    if (!msgContent) continue;
   ```
6. Extrair o JID do remetente: `const sender = jid;`
7. Extrair o texto da mensagem com lógica defensiva:
   ```javascript
   const text =
     msgContent?.conversation ||
     msgContent?.extendedTextMessage?.text ||
     null;
   ```
8. Se `text` for `null`, encaminhar para o roteador de mídia se o callback for válido:
   ```javascript
   if (typeof routeMedia === 'function') {
      await routeMedia(sock, sender, msgContent, msg, processTextMessage);
   }
   ```
9. Se `text` não for `null`, chamar o callback de processamento se válido:
   ```javascript
   if (typeof processTextMessage === 'function') {
      await processTextMessage(sock, sender, text, msg);
   }
   ```
10. Exportação Final: `module.exports = { handleMessage };`

---

### Passo 3: O Roteador de Mídia (Estrutura Inicial)

**Ação:** Criar a camada de orquestração que identifica o tipo de mídia recebida e direciona para o handler correto, evitando que o sistema quebre ao receber qualquer tipo de arquivo.

#### 3.1 — Criar `/src/orchestrator/mediaRouter.js`

**No topo de `mediaRouter.js`, adicione a importação do manipulador de arquivos:**
`const { handleFile } = require('./fileHandler');`

Este arquivo exporta uma função **assíncrona** `async function routeMedia(sock, sender, msgContent, msg, processTextMessage)`.

Ela deve inspecionar o objeto `msgContent` para identificar o tipo de conteúdo usando a seguinte lógica de detecção (verificar a existência da chave).
Antes de identificar a chave de mídia, o roteador deve validar se `msgContent` é um objeto válido (`if (!msgContent || typeof msgContent !== 'object')`). Se for inválido e `sock.sendMessage` for uma função, responda ao remetente com "Recebi conteúdo inválido." e encerre a execução. Apenas prossiga com as verificações (`imageMessage`, etc.) se o objeto for válido.

| Chave presente em `msgContent` | Tipo de mídia |
|---|---|
| `imageMessage` | Imagem |
| `audioMessage` | Áudio |
| `documentMessage` | Documento/Arquivo |
| `videoMessage` | Vídeo |
| `stickerMessage` | Sticker |

 Para cada tipo, executar a ação correspondente (sempre validando se o socket está pronto):
- **Imagem, Vídeo, Sticker:** Responder ao usuário:
  ```javascript
  if (sock && typeof sock.sendMessage === 'function') {
     await sock.sendMessage(sender, { text: '🖼️ Recebi uma mídia visual. O suporte a imagens estará disponível em breve!' });
  } else {
     console.warn('[WHATSAPP] sock.sendMessage não é uma função');
  }
  ```
- **Áudio:** Responder com `'🎙️ Recebi um áudio. O suporte a transcrição estará disponível em breve!'` usando `await` e a mesma validação defensiva de `sock.sendMessage`.
- **Documento:** Chamar com `await`: `await handleFile(sock, sender, msg, processTextMessage)` (implementado em 3.2).
- **Tipo desconhecido:** Responder com uma mensagem genérica de aviso usando `await` e a validação defensiva de `sock.sendMessage`.
- **Exportação Final:** `module.exports = { routeMedia };`

#### 3.2 — Criar `/src/orchestrator/fileHandler.js`

Este arquivo exporta uma função assíncrona `handleFile(sock, sender, msg, processTextMessage)`.

**No início do arquivo, coloque obrigatoriamente os seguintes `require` e constantes globais:**
```javascript
const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const config = require('../../config.json');
const DOWNLOAD_TIMEOUT_MS = 10000;
```

**Toda a função deve estar envolvida em um bloco `try/catch`.**

Lógica:
1. Normalizar a mensagem para evitar crash com mensagens temporárias:
   ```javascript
   const msgContent = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message;
   const doc = msgContent?.documentMessage;
   if (!doc) return;
   ```
2. Validar tamanho do arquivo com conversão segura de Long:
   - Defina os limites (`maxMb` e `maxBytes`).
   - Tente resolver objetos Long protobuf: se `doc.fileLength` for um objeto com a função `toNumber()`, execute-a. Caso contrário, utilize o fallback seguro `Number(doc.fileLength || doc.fileLengthLow || doc.fileSize || doc.size || 0) || 0`.
   - Se o tamanho reportado ultrapassar o limite e `sock.sendMessage` for função, envie aviso ao usuário informando o tamanho e retorne.
3. Checar extensão e MIME Type:
   ```javascript
   const allowedExtensions = ['.js', '.ts', '.txt', '.json', '.md', '.py', '.env', '.sh'];
   const ext = path.extname(doc.fileName || '').toLowerCase();
   const mime = doc.mimetype || '';
   
   if (!allowedExtensions.includes(ext) && !mime.startsWith('text') && mime !== 'application/json') {
      if (sock && typeof sock.sendMessage === 'function') {
         await sock.sendMessage(sender, { text: 'Extensão ou tipo de arquivo não suportado.' });
      } else {
         console.warn('[WHATSAPP] sock.sendMessage não é uma função');
      }
      return;
   }
   ```
   > ⚠️ **Nota de Segurança (CORREÇÃO):** As extensões `.env` e `.sh` não devem constar na whitelist por padrão em ambientes de produção. Elas permanecem listadas aqui apenas para testes locais controlados. Recomenda-se **remover** `.env` e `.sh` da lista de `allowedExtensions` em produção ou exigir um opt-in explícito (flag de configuração) e um processo de sanitização/validação manual.
4. Se a extensão **for** permitida:
   - **Verificação de APIs:** Antes de iniciar o download, valide se `typeof downloadMediaMessage === 'function'` e `typeof downloadContentFromMessage === 'function'`. Se alguma não existir, lance um erro descritivo.
   - **Download com Fallback e Timeout:** Tente o download padrão e, em caso de falha, use o stream do fallback, ambos protegidos por um `Promise.race` de timeout de 10 segundos. Se falhar, o buffer será verificado via `Buffer.isBuffer(buffer)`.
   - Calcule o caminho temporário (`.tmp`) e o caminho final.
   - **Escrita Atômica com Tratamento de I/O e Cleanup:**
     - Envolva as operações de disco (`fs.mkdirSync`, `fs.writeFileSync`, `fs.renameSync`) em um bloco `try/catch`.
     - No `catch`, registre o erro de salvamento (`console.error`). Se o socket for válido (`typeof sock.sendMessage === 'function'`), envie a mensagem "Falha ao salvar arquivo no servidor." ao usuário e propague o erro.
     - Utilize um bloco `finally` obrigatório para remover o arquivo temporário (`.tmp`) com `fs.unlinkSync`, caso ele ainda exista, ignorando erros desse cleanup.
   - **Variáveis e Conversão:**
     - **Cheque que `buffer` existe:** antes de usar `buffer.toString()` garanta que `buffer` foi atribuído pelo bloco de download/fallback (ver seção "Download / fallback"). Se `buffer` for `undefined` lance um erro descritivo e notifique o usuário.
     ```javascript
     let conteudo = '';
     try {
        conteudo = buffer.toString('utf-8');
     } catch (e) {
        if (sock && typeof sock.sendMessage === 'function') {
           await sock.sendMessage(sender, { text: 'Erro ao ler arquivo.' });
        } else {
           console.warn('[WHATSAPP] sock.sendMessage não é uma função');
        }
        return;
     }
     ```
   - Formatar a string: `const fullText = \`[ARQUIVO RECEBIDO: ${safeName}]\n\nConteúdo:\n${conteudo}\`;`
   - Passar para a IA: `await processTextMessage(sock, sender, fullText, msg);`
   - **Exportação Final:** `module.exports = { handleFile };`

   Observações críticas (correções para evitar ReferenceError/streams):

   - **Derivação de `safeName`**: o texto acima usa `safeName` sem dizer como obtê-lo. Implemente explicitamente algo como:
      ```javascript
      const safeName = String(doc.fileName || 'unnamed').replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeBase = path.basename(safeName);
      ```
      Sem isso um `ReferenceError` ocorrerá ao formatar `fullText`.

   - **Download / fallback (stream → Buffer)**: seja explícito sobre como transformar o resultado de `downloadContentFromMessage` (async iterable/stream) em `Buffer` antes de `buffer.toString()`:
      ```javascript
      // exemplo de coleta de chunks de async iterable (use `doc` extraído de msgContent)
      const stream = await downloadContentFromMessage(doc, 'document');
      const chunks = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const buffer = Buffer.concat(chunks);
      ```
      Sem essa coleta, implementadores podem tentar chamar `toString()` em uma stream ou em `undefined`.

   - **Assinatura / argumentos das APIs do Baileys**: várias versões da biblioteca aceitam entradas diferentes. Recomende verificar/usar o objeto `msg`/`msg.message.documentMessage` como primeiro argumento e documentar a versão do Baileys. Exemplo sugerido:
      ```javascript
      // tentativa padrão, ajustar conforme versão do Baileys utilizada
      try {
         buffer = await downloadMediaMessage(doc);
      } catch (e) {
         const stream = await downloadContentFromMessage(doc, 'document');
         // coletar chunks como acima
      }
      ```

   - **Timeout / cancelamento / cleanup**: `Promise.race` deve incluir limpeza explícita do stream em caso de timeout (ex: `stream.destroy()` ou `controller.abort()` se suportado). Caso contrário o stream pode permanecer aberto e causar erros subsequentes.


---

### Passo 4: Integração do Cérebro com a Boca (O Loop Principal)

**Ação:** Atualizar o `index.js` para substituir o terminal (`readline`) pelo WhatsApp como interface de entrada e saída.

#### 4.1 — Atualizar `index.js` (Raiz)

*Lembrete de Assinatura:* A função principal será `processTextMessage(sock, sender, text, msg)`. Ela receberá `msg` para marcar a mensagem como lida e será passada como callback desde o `index.js` até chegar no `messageHandler.js` e no `fileHandler.js`.

O novo `index.js` deve implementar um bloco `try/catch` global para `processTextMessage`:

**Cole o código abaixo exatamente no `index.js`, antes da inicialização do WhatsApp:**
```javascript
const { salvarMensagem, buscarUltimasMensagens } = require('./src/memory/memoryManager');
const { buildPrompt } = require('./src/core/promptBuilder');
const { enviarPrompt } = require('./src/core/llmClient');
const { extrair } = require('./src/core/jsonExtractor');
const config = require('./config.json');

// Validação de Contrato (Garantir que a Fase 1 foi importada corretamente)
if (!salvarMensagem || !buscarUltimasMensagens || !enviarPrompt || !extrair || !buildPrompt) {
   console.error('[INDEX][CRÍTICO] Módulos da Fase 1 incompletos ou inválidos.');
   process.exit(1);
}

// Validação defensiva de configuração: fallback para `max_buffer`
// Use um valor padrão razoável caso `config.memoria.max_buffer` esteja ausente ou inválido.
// O código de exemplo no `index.js` deve usar `MAX_BUFFER` em vez de acessar `config.memoria.max_buffer` diretamente.
const maxBufferConfigured = Number(config?.memoria?.max_buffer || 0) || 0;
const MAX_BUFFER = Number.isFinite(maxBufferConfigured) && maxBufferConfigured > 0 ? maxBufferConfigured : 20;
// Exemplo de uso: const historico = await buscarUltimasMensagens(MAX_BUFFER);

async function processTextMessage(sock, sender, text, msg) {
   try {
      if (msg?.key) {
         if (typeof sock.readMessages === 'function') {
            await sock.readMessages([msg.key]);
         } else {
            console.warn('[WHATSAPP] sock.readMessages não é uma função');
         }
      }
      if (typeof sock.sendPresenceUpdate === 'function') {
         await sock.sendPresenceUpdate('composing', sender);
      } else {
         console.warn('[WHATSAPP] sock.sendPresenceUpdate não é uma função');
      }

      const safeText = text.length > 10000 ? text.slice(0, 10000) + '\n\n[TEXTO TRUNCADO]' : text;
      await salvarMensagem({ role: 'user', content: safeText });
      const historico = await buscarUltimasMensagens(MAX_BUFFER);
      const promptPayload = buildPrompt(safeText, historico);
      const respostaBruta = await enviarPrompt(promptPayload);
      
      if (typeof respostaBruta !== 'string') throw new Error('Resposta do LLM inválida');
      const respostaJson = extrair(respostaBruta);
      
      if (!respostaJson || typeof respostaJson.reply !== 'string') {
         throw new Error('Resposta do LLM não contém o campo "reply"');
      }

      await salvarMensagem({ role: 'assistant', content: respostaJson.reply });
      
      if (sock && typeof sock.sendMessage === 'function') {
         await sock.sendMessage(sender, { text: respostaJson.reply });
      } else {
         console.warn('[WHATSAPP] sock.sendMessage não é uma função');
      }
   } catch (error) {
      console.error('[PROCESS_TEXT][ERRO]', error);
      if (sock && typeof sock.sendMessage === 'function') {
         await sock.sendMessage(sender, { text: 'Erro interno ao processar sua solicitação.' }).catch(e => {});
      } else {
         console.warn('[WHATSAPP] sock.sendMessage não é uma função (erro no catch)');
      }
   }
}

// Startup Wrapper
const { initWhatsApp } = require('./src/plugins/whatsapp/connection');
const { handleMessage } = require('./src/plugins/whatsapp/messageHandler');

async function onMessageReceived(sock, messages, type) {
   try {
      await handleMessage(sock, messages, type, processTextMessage);
   } catch (err) { console.error('[MAIN][ERRO] onMessageReceived', err); }
}

(async () => {
   const sock = await initWhatsApp(onMessageReceived);
   if (!sock) {
      console.error('[MAIN][CRÍTICO] Falha ao iniciar socket');
      process.exit(1);
   }
})();
```

---

## PADRÃO DE LOG OBRIGATÓRIO

console.log('[MODULO] mensagem');
console.error('[MODULO][ERRO]', erro);

Exemplos:
console.log('[WHATSAPP] Conectado');
console.error('[FILE_HANDLER][ERRO]', error);

## REGRA DE IMPORTAÇÃO (PADRONIZAÇÃO)

1. **Módulos Nativos (fs, path, events, pino):** Importe sempre como objeto completo: `const fs = require('fs');`.
2. **Módulos do Projeto (/src):** Use obrigatoriamente desestruturação (Named Imports): `const { func } = require(...);`.
3. Todo arquivo deve começar com require explícito no topo.
⚠️ PROIBIDO usar módulos sem require.

## REGRA DE ESCOPO

- Sempre usar const ou let
- Nunca usar var
- Nunca criar variável global implícita

## VALIDAÇÃO DEFENSIVA DE MÉTODOS DO SOCKET

Antes de chamar qualquer método do objeto `sock` (`sock.readMessages`, `sock.sendPresenceUpdate`, `sock.sendMessage`), **sempre** verifique `typeof sock.method === 'function'`. Isso protege contra versões do Baileys que renomeiam ou removem métodos entre releases.
```javascript
// validação defensiva: evita TypeError se método não existir nesta versão do Baileys
if (typeof sock.readMessages === 'function') {
   await sock.readMessages([msg.key]);
} else {
   console.warn('[WHATSAPP] sock.readMessages não é uma função');
}
```

---

### Passo 5: Validação Isolada (Script de Teste de Mídia)

**Ação:** Criar um script de teste independente do cérebro para validar exclusivamente o recebimento e download de arquivos via WhatsApp.

#### 5.1 — Criar `/TMP_SCRIPTS/test_media_download.js`

O arquivo **deve começar** com o seguinte cabeçalho de comentário:
```javascript
/**
 * TMP_SCRIPTS/test_media_download.js
 *
 * PROPÓSITO: Testar o recebimento e download de arquivos via WhatsApp,
 *            independentemente do cérebro (LLM). O bot opera em modo "eco".
 *
 * COMO EXECUTAR: node TMP_SCRIPTS/test_media_download.js
 *
 * O QUE VALIDA:
 *   1. A conexão com o WhatsApp funciona (QR Code ou sessão salva).
 *   2. O bot recebe um arquivo de código (.js, .txt, etc.) enviado pelo celular.
 *   3. O arquivo é salvo com sucesso em ./temp_workspace/.
 *   4. O conteúdo do arquivo é lido e impresso no console.
 *   5. O bot responde no WhatsApp confirmando o recebimento e mostrando um preview.
 *
 * COMO USAR:
 *   - Inicie o script.
 *   - Escaneie o QR Code OU aguarde a reconexão automática.
 *   - Envie um arquivo .js ou .txt para o número do bot via WhatsApp.
 *   - Observe o console e aguarde a resposta de confirmação no WhatsApp.
 */
```

**Instrução técnica obrigatória para o teste (Padrão Observer):**

> **Importante:** `connection.js` deve exportar **a mesma instância** `socketEmitter` criada no topo do arquivo. A exportação é: `module.exports = { initWhatsApp, socketEmitter };`. O script de teste faz `require` dessa instância compartilhada.
>
> Nota: o `require` do Node normalmente retorna a mesma instância em cache, mas isso só funciona se `connection.js` exportar a instância `socketEmitter` criada uma vez no topo do módulo (não uma função que cria um novo `EventEmitter` a cada chamada). Verifique que `socketEmitter` é declarado e exportado exatamente como singleton.

- **Ordem de Execução (Crítico):** O listener `socketEmitter.on('socket', ...)` deve ser registrado obrigatoriamente **antes** da chamada da função `initWhatsApp()` para evitar a perda do evento de primeira conexão.
- Crie a variável `let currentSock;`.
- Escute o emissor: `socketEmitter.on('socket', (sock) => { currentSock = sock; });`
- **Timeout Observável do Script:** O arquivo de teste **deve** implementar um timeout observável global (ex: 20 segundos) esperando o evento de conexão do `socketEmitter`. Se o limite for atingido sem receber o socket, o script deve registrar um log claro (`console.error('[TEST_MEDIA] erro de inicialização, socket não recebido')`) e forçar o encerramento do processo com `process.exit(1)`.
- Chame `initWhatsApp` passando um callback que usa `currentSock` para responder.

O script deve usar o `connection.js` já criado e a lógica de eco. **Obrigatório:** Importar e utilizar o `handleFile` de `../src/orchestrator/fileHandler.js` para processar downloads. O callback de eco deve ser `async` e responder com: `📄 Arquivo recebido: [Nome do Arquivo] (Preview: [Primeiros 100 caracteres...])`.
- **Importação de Socket:** `const { initWhatsApp, socketEmitter } = require('../src/plugins/whatsapp/connection');`
- **Importação de Handler:** `const { handleFile } = require('../src/orchestrator/fileHandler');`

---

## Estrutura de Diretórios ao Final da Fase 2

```text
/the-a-gent
│
├── /src
│   ├── /core           ✅ (Fase 1 - não modificar)
│   ├── /memory         ✅ (Fase 1 - não modificar)
│   ├── /plugins
│   │   └── /whatsapp
│   │       ├── connection.js     ← NOVO (Passo 1)
│   │       └── messageHandler.js ← NOVO (Passo 2)
│   └── /orchestrator
│       ├── mediaRouter.js        ← NOVO (Passo 3)
│       └── fileHandler.js        ← NOVO (Passo 3)
│
├── /TMP_SCRIPTS
│   └── test_media_download.js    ← NOVO (Passo 5)
│
├── /auth_info          ← Criado automaticamente pelo Baileys
├── /temp_workspace/    ← Criado automaticamente pelo fileHandler
├── index.js            ← ATUALIZADO (Passo 4)
└── package.json        ← ATUALIZADO (Passo 1)
```

---

## Armadilhas Conhecidas do Baileys (Ler antes de codificar)

1. **`sock` não é global:** O socket só existe depois que `initWhatsApp` resolve. Nunca declare `let sock` fora do escopo e tente usá-lo antes da inicialização.
2. **Não esquecer `saveCreds`:** O listener `creds.update` com `saveCreds()` é **obrigatório**. Sem ele, o QR Code será pedido toda vez que o processo reiniciar.
3. **`DisconnectReason.loggedOut`:** Nunca tente reconectar se o motivo for logout. O WhatsApp pode bloquear o número por comportamento suspeito.
4. **Mensagens duplicadas:** O evento `messages.upsert` pode disparar com mensagens antigas ao reconectar. O filtro `msg.key.fromMe` e a verificação de `msg.message` ajudam a mitigar isso.
5. **Extensão do JID:** JIDs de grupos terminam em `@g.us`. JIDs de contatos terminam em `@s.whatsapp.net`. Sempre use `.endsWith()` para verificar, nunca comparação exata.

---

**CONTRATOS DE EXPORTAÇÃO (OBRIGATÓRIO - FORMATO { NAMED_EXPORTS })**

| Módulo | Exportação | Arquivo |
|---|---|---|
| memoryManager | `{ salvarMensagem, buscarUltimasMensagens }` | Fase 1 |
| llmClient | `{ enviarPrompt }` | Fase 1 |
| jsonExtractor | `{ extrair }` | Fase 1 |
| promptBuilder | `{ buildPrompt }` | Fase 1 |
| connection | `{ initWhatsApp, socketEmitter }` | Fase 2 |
| messageHandler | `{ handleMessage }` | Fase 2 |
| mediaRouter | `{ routeMedia }` | Fase 2 |
| fileHandler | `{ handleFile }` | Fase 2 |

---

## CHECKLIST OBRIGATÓRIO DE REVISÃO DE CÓDIGO
- [ ] Cada função async possui try/catch.
- [ ] `require()` declarados apenas no topo dos arquivos.
- [ ] Módulos Nativos (fs, path, events, pino): Importados como objeto completo (`const fs = require('fs');`).
- [ ] Módulos do Projeto (/src): Usam obrigatoriamente desestruturação (Named Imports).
- [ ] Todos os arquivos terminam com `module.exports = { func };`.
- [ ] `initWhatsApp` protege contra reentrada (`isConnecting`).
- [ ] `isConnecting` reseta em 3 pontos: (A) `catch` de boot, (B) `connection === 'close'`, (C) antes de `return sock`. Nunca em `finally`.
- [ ] Reconexão usa exclusivamente `setTimeout`. Proibido `await initWhatsApp(...)` dentro de listeners.
- [ ] O tratamento de `creds.update` tem `await saveCreds()` com tratamento de erro.
- [ ] Downloads usam `downloadMediaMessage` com fallback para `downloadContentFromMessage`; timeout via `Promise.race`; `.tmp` + atomic rename + cleanup no `finally`.
- [ ] Tamanho de arquivo normalizado com `Number(doc.fileLength || doc.fileLengthLow || doc.fileSize || doc.size || 0)`.
- [ ] Todas as chamadas a `sock.sendMessage`, `sock.readMessages` e `sock.sendPresenceUpdate` possuem validação `typeof === 'function'` (compatibilidade entre versões).
- [ ] No script de teste, `socketEmitter.on('socket', ...)` é registrado **antes** de `initWhatsApp()`.
- [ ] Filtro de timestamp de 60s usa `getMessageTimestamp(msg)` no loop do `messageHandler`.
- [ ] Loop `for..of` usa `continue` para pular mensagens. Proibido `return` dentro do loop.
- [ ] Callbacks validados com `typeof === 'function'` antes de chamar (`processTextMessage`, `routeMedia`).

**Status de Conclusão:** A Fase 2 estará concluída quando você puder enviar a mensagem "Qual é a sua missão?" pelo WhatsApp no seu celular, o The A-gent marcar a mensagem como "lida", processar a resposta através do Ollama usando hostnames, e te responder no WhatsApp de forma estruturada. Além disso, se o processo for reiniciado, ele deve se reconectar sozinho sem pedir o QR Code.

---

## CHANGELOG

1. `reportedSize`: Simplificado e forçado com `Number()` para evitar erros de comparação com strings em runtime.
2. `fileHandler.js` (extensão não suportada): Adicionada validação defensiva `if (sock && typeof sock.sendMessage === 'function')` antes do envio.
3. `fileHandler.js` (erro de leitura): Adicionada validação defensiva `if (sock && typeof sock.sendMessage === 'function')` antes do envio.
4. `connection.js` (numeração): Corrigida numeração duplicada do passo 10 → passos 10, 11, 12, 13, 14.
5. `connection.js` (Trava): Proibição explícita do uso de `finally` para reset de `isConnecting`. Reset movido para `catch` e `close` event.
6. `messageHandler.js` (Sintaxe): Removida instrução duplicada de import no início da seção.
7. `messageHandler.js` (Filtro): Implementado filtro de timestamp de 60s otimizado com `Math.floor(Date.now() / 1000)`.
8. Regras de Importação: Padronização de require (objeto completo para nativos, desestruturação para locais).
9. Tabela de contratos: Expandida para incluir os 4 módulos da Fase 2 com formato tabular.
10. Checklist: Expandido para 14 itens cobrindo as novas regras de blindagem.

---

## PATCH LOG (Normalização Final — 2026-04-30)

1. **EventEmitter → `events.EventEmitter`:** Substituído `const EventEmitter = require('events')` por `const events = require('events')` + `new events.EventEmitter()`. Removida referência solta a `EventEmitter`.
2. **Imports explícitos em `connection.js`:** Bloco de `require` completo adicionado (events, pino, qrcode, baileys desestruturado) com code fence, eliminando ambiguidade.
3. **`downloadContentFromMessage` no `fileHandler.js`:** Adicionado à desestruturação do Baileys no topo do arquivo. Garantia de que o fallback de download tem a dependência importada.
4. **Download com `Promise.race` + fallback:** Estratégia unificada: `downloadMediaMessage` → catch → `downloadContentFromMessage` stream, tudo dentro de `Promise.race` com `DOWNLOAD_TIMEOUT_MS`.
5. **`routeMedia` import no `messageHandler.js`:** Seção reformulada com code fence explícito mostrando o `require`.
6. **Checklist corrigido:** Removida contradição "exclusivamente downloadMediaMessage"; substituída por "downloadMediaMessage com fallback para downloadContentFromMessage".
7. **Política `isConnecting`:** Confirmada e unificada — reset apenas em `catch` (boot) e `connection === 'close'` (antes do `setTimeout`). Nenhum `finally`.

---

## Nota de Revisão Automática (2026-04-30 v2)

1. **`isConnecting` → política de 3 pontos:** Adicionado ponto (C) — reset antes de `return sock` em sucesso. Removida ambiguidade "dois pontos" vs. esquecimento do sucesso.
2. **Download de mídia unificado:** Texto canônico `downloadWithFallback()` + `Promise.race` + validação `Buffer.isBuffer`. Removidas instruções que diziam "exclusivamente downloadMediaMessage".
3. **Fallback padronizado:** Todas as referências usam `doc` (extraído de `msgContent.documentMessage`) como argumento de `downloadContentFromMessage(doc, 'document')`.
4. **`reportedSize` expandido:** Cadeia `doc.fileLength || doc.fileLengthLow || doc.fileSize || doc.size || 0` com comentário de prioridade protobuf.
5. **`getMessageTimestamp(msg)`:** Função utilitária canônica adicionada. Tenta `messageTimestamp`, `key.timestamp`, `message.timestamp`. Todas as verificações de 60s agora referenciam essa função.
6. **Validação de sock methods:** Seção dedicada "VALIDAÇÃO DEFENSIVA DE MÉTODOS DO SOCKET" com exemplo e justificativa de compatibilidade.
7. **`socketEmitter` singleton:** Nota explícita reforçando que `connection.js` exporta a mesma instância; script de teste faz `require` dela.
8. **Contratos com validação:** Cada contrato canônico agora exige `typeof === 'function'` antes de chamar callbacks. Nota sobre `try/catch` obrigatório em toda função async.
9. **Regras de importação reconciliadas:** Uma única regra documentada: nativos como objeto completo, projeto com desestruturação. Checklist alinhado.
10. **Segurança `.env`/`.sh`:** Nota de advertência sobre extensões sensíveis na whitelist.
11. **Versão do Baileys:** Recomendação de fixar versão no `package.json` e documentar APIs esperadas.
12. **Arquivo completo:** Verificado que não há truncamento. Changelog e PATCH LOG preservados integralmente.
