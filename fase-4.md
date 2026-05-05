# Plano de Ação — Fase 4: Os Olhos (Navegação Web e Scrapping)

**Objetivo da Fase:** Conceder ao The A-gent a capacidade de pesquisar na web e extrair conteúdo textual de páginas, usando o Crawlee (CheerioCrawler) como motor HTTP/HTML de baixo consumo. Será implementada uma camada de segurança SSRF de nível empresarial, proteção contra loops de redirect, e sanitização agressiva de HTML, garantindo que a IA possa analisar informações da internet sem comprometer o host.

**Pré-requisito:** Fases 1 a 3 operacionais (LLM, WhatsApp, execução de ferramentas de sistema).

---

## Instruções Críticas para o Agente Codificador (Antigravity/IA)

1. **Didática Obrigatória:** Todo código deve vir acompanhado de comentários arquiteturais explicando **por que** cada bloco existe, não apenas **o que** faz. Antes de cada arquivo, insira um cabeçalho explicativo com o propósito, entradas esperadas e saídas.
2. **CommonJS Estrito:** `"type": "commonjs"` no `package.json`. Use `require()` e `module.exports`. Proibido `import/export`.
3. **Segurança SSRF não-negociável:** A proteção deve checar não só a URL inicial, mas também cada redirect (HTTP 301/302/307/308). Consulte a seção "Passo 2.1 — A Defesa SSRF Definitiva" para detalhes.
4. **Modularidade (SRP):** Cada tool é um arquivo em `/src/tools`. Funções auxiliares em `/src/utils`. Respeitar soft limit de 250-500 lines.
5. **Anti-Token Exhaustion:** Limpeza agressiva do HTML extraído. Consulte a seção "Passo 1.2 — Sanitização de Conteúdo" para os seletores obrigatórios.
6. **Versionamento:** Proibido commit/push automáticos.
7. **Hostnames para rede interna:** Toda comunicação de rede (LLM, webhooks) usa hostname, nunca IP fixo.
8. **Padrão de Resposta das Tools:** Toda tool assíncrona retorna `{ success: boolean, data?: any, error?: string }`.

---

## Contexto Técnico: Por que Crawlee + CheerioCrawler?

O Crawlee é uma biblioteca de web scraping/crawling para Node.js que fornece:
- **CheerioCrawler:** Crawler HTTP puro que usa a biblioteca Cheerio (jQuery-like) para parse de HTML. Consome ~50 MB de RAM vs ~500 MB de um crawler baseado em browser como Playwright/Puppeteer.
- **Gestão automática de concorrência:** Pool de workers escalável baseado em CPU/memória disponível.
- **Retry automático:** Com `maxRequestRetries`, o crawler re-tenta requisições falhas automaticamente.
- **Session Pool:** Rotação de sessões para evitar bloqueios.
- **Storage:** Suporte a armazenamento em disco ou em memória (`persistStorage: false`).

Para o The A-gent, que precisa apenas buscar uma única URL ou página de resultados de busca e extrair texto (sem JavaScript rendering), o CheerioCrawler é a escolha ideal — rápido, leve e escalável.

**Comparativo CheerioCrawler vs PuppeteerCrawler:**
| Aspecto | CheerioCrawler | PuppeteerCrawler |
|---------|----------------|-------------------|
| RAM | ~50 MB | ~500 MB |
| Velocidade | 10x mais rápido | Lento (renderização) |
| JS Rendering | Não | Sim |
| Uso no The A-gent | ✅ Ideal | ❌ Excessivo |

---

## Roteiro de Execução (Passo a Passo)

### Passo 1: Instalação de Dependências

```bash
npm install crawlee cheerio
```

**Por que não Playwright/Puppeteer?** O CheerioCrawler faz requisições HTTP puras, parseando o HTML com Cheerio (leve, jQuery-like). Não executa JavaScript, portanto consome muito menos memória e CPU. Ideal para buscar e extrair texto de páginas estáticas. Para o DuckDuckGo, usaremos a versão estática (`html.duckduckgo.com`), que não requer JS.

**Versão recomendada:** Fixar `"crawlee": "^3.13"` no `package.json` para evitar breaking changes. APIs documentadas esperadas: `CheerioCrawler`, `Configuration`, `purgeDefaultStorages`, `RequestQueue`, `log`.

---

### Passo 1.2 — Sanitização de Conteúdo (Obrigatória)

Antes de criar as ferramentas, é preciso definir o contrato de sanitização que será usado por `webScraper.js`.

#### Por que sanitizar agressivamente?

Modelos de LLM têm limites de tokens de entrada (context window). Um HTML bruto de 2 MB pode conter 95% de ruído: scripts, estilos CSS inline, SVGs enormes, imagens em Base64, comentários HTML, metadados obscuros. Enviar tudo para o LLM causaria **token exhaustion** (estouro da janela de contexto) e degradação da qualidade da resposta, pois o modelo gastaria tokens processando lixo.

Além disso, enviar o HTML completo com `<script>`, `<style>`, `<iframe>`, `<svg>`, imagens Base64 e comentários é desperdício de contexto para o LLM.

#### Seletores a REMOVER (lista exaustiva):

```javascript
const REMOVE_SELECTORS = [
  'script', 'style', 'noscript',        // Código e CSS
  'svg', 'canvas', 'video', 'audio',    // Mídia não-textual
  'iframe', 'frame', 'object', 'embed', // Conteúdo embutido
  'img[src^="data:"]',                  // Imagens Base64 embutidas
  'link[rel="stylesheet"]',             // CSS externo
  'meta', 'head',                        // Metadados
  'nav', 'footer', 'header',            // Navegação estrutural
  'form', 'input', 'button', 'select',  // Elementos de formulário
  '[style*="display:none"]',            // Elementos ocultos
  '[style*="display: none"]',           // Variante com espaço
  '[hidden]', '[aria-hidden="true"]',   // Elementos escondidos
  '.sidebar', '.nav', '.menu', '.ad',   // Classes comuns de UI
  '.footer', '.header', '.comment',     // Mais classes comuns
  '#sidebar', '#nav', '#menu',           // IDs comuns de UI
  'template',                            // Templates não renderizados
];
```

#### Limpeza Adicional de Texto (Pós-Cheerio):

```javascript
function cleanExtractedText(rawText) {
  return rawText
    // Remove comentários HTML residuais (<!-- ... -->)
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove sequências de whitespace excessivas
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{3,}/g, '  ')
    // Remove linhas em branco no início/fim
    .trim();
}
```

#### Truncamento Inteligente:
- Máximo de **15.000 caracteres** extraídos por página.
- Se o texto ultrapassar, truncar no último espaço antes do limite e anexar `\n\n[TEXTO TRUNCADO. Máximo de 15000 caracteres atingido.]`.
- O valor de 15000 caracteres deve ser configurável via `config.json` em `"web": { "max_extracted_chars": 15000 }`. Na ausência dessa chave, usar 15000 como default defensivo.

#### Detecção de Arquivos Não-HTML:

Antes de iniciar a extração, verificar o `Content-Type` da resposta. Se não for `text/html`, `application/xhtml+xml`, `text/plain`, ou `application/json`, abortar com uma mensagem clara: "Tipo de conteúdo não suportado para extração: {contentType}". Isso evita tentar parse de PDFs, binários, arquivos ZIP de 50 MB, etc. Implementar verificação do header `content-type` da resposta (via `request.rawResponse?.headers['content-type']`) e também inspeção dos primeiros bytes do corpo para detectar magic bytes de formatos não-texto (PDF: `%PDF`, PNG: `\x89PNG`, etc.).

---

### Passo 2: A Defesa SSRF (Atualização do SecurityLayer)

**Ação:** Blindar o `securityLayer.js` existente com uma proteção SSRF de nível empresarial que vai muito além de regex.

**Arquivo a modificar:** `/src/core/securityLayer.js`

#### 2.1 — A Defesa SSRF Definitiva (Nova Seção)

**Motivação:** Um LLM pode ser induzido (via prompt injection ou alucinação) a tentar acessar URLs como `http://127.0.0.1:11434/api/generate` (o próprio Ollama), `http://169.254.169.254/latest/meta-data/` (metadata cloud AWS), ou `http://localhost/admin`. Sem SSRF, o agente leria esses endpoints e vazaria informações sensíveis.

**Abordagem proibida:** Regex, blacklist de strings, verificação só do hostname. Estas são triviais de burlar.

**Abordagem correta (OWASP):**
1. Normalizar a URL (WHATWG URL API)
2. Restringir protocolos a `http:` e `https:`
3. Resolver DNS do hostname
4. Classificar o IP resultante contra ranges privados/reservados
5. Para cada redirect (301/302/307/308), repetir os passos 1-4
6. Rejeitar se qualquer IP da cadeia for interno

#### 2.2 — Novas Funções no securityLayer.js

```javascript
// NOVO: Adicionar ao securityLayer.js existente
const dns = require('dns');
const { URL } = require('url');

// IPv4 Private/Restricted Ranges
const BLOCKED_IPV4_RANGES = [
  { network: '0.0.0.0', prefix: 8, reason: 'Current network (RFC 1122)' },
  { network: '10.0.0.0', prefix: 8, reason: 'Private network (RFC 1918)' },
  { network: '100.64.0.0', prefix: 10, reason: 'Carrier-grade NAT (RFC 6598)' },
  { network: '127.0.0.0', prefix: 8, reason: 'Loopback (RFC 1122)' },
  { network: '169.254.0.0', prefix: 16, reason: 'Link-local (RFC 3927)' },
  { network: '172.16.0.0', prefix: 12, reason: 'Private network (RFC 1918)' },
  { network: '192.0.0.0', prefix: 24, reason: 'IETF Protocol Assignments (RFC 5736)' },
  { network: '192.0.2.0', prefix: 24, reason: 'TEST-NET-1 (RFC 5737)' },
  { network: '192.168.0.0', prefix: 16, reason: 'Private network (RFC 1918)' },
  { network: '198.18.0.0', prefix: 15, reason: 'Network benchmark (RFC 2544)' },
  { network: '198.51.100.0', prefix: 24, reason: 'TEST-NET-2 (RFC 5737)' },
  { network: '203.0.113.0', prefix: 24, reason: 'TEST-NET-3 (RFC 5737)' },
  { network: '224.0.0.0', prefix: 4, reason: 'Multicast (RFC 5771)' },
  { network: '240.0.0.0', prefix: 4, reason: 'Reserved (RFC 1112)' },
];

// IPv6 Private/Restricted Ranges
const BLOCKED_IPV6_RANGES = [
  { network: '::1', prefix: 128, reason: 'Loopback' },
  { network: '::', prefix: 128, reason: 'Unspecified address' },
  { network: 'fe80::', prefix: 10, reason: 'Link-local' },
  { network: 'fc00::', prefix: 7, reason: 'Unique local (RFC 4193)' },
  { network: 'ff00::', prefix: 8, reason: 'Multicast' },
  { network: '2001:db8::', prefix: 32, reason: 'Documentation (RFC 3849)' },
  { network: '::ffff:0:0', prefix: 96, reason: 'IPv4-mapped IPv6' },
  { network: '64:ff9b::', prefix: 96, reason: 'IPv4/IPv6 translation (RFC 6052)' },
  { network: '2002::', prefix: 16, reason: '6to4 (RFC 3056)' },
];

// Hostnames que sempre devem ser bloqueados
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'localhost6',
  'metadata.google.internal',   // GCP
  '169.254.169.254',             // AWS / cloud metadata IP
]);
```

#### 2.3 — Funções Utilitárias de IP

```javascript
function ip4ToInt(ip) { /* converte "10.0.0.1" → 167772161 */ }
function ip6ToBigInt(ip) { /* converte "::1" → 1n */ }
function isIPv4InRange(ip, network, prefix) { /* verifica se ip está no range */ }
function isIPv6InRange(ip, network, prefix) { /* verifica se ip está no range */ }
function isBlockedIP(ip, family) { /* itera sobre BLOCKED_IPV{4,6}_RANGES */ }
```

#### 2.4 — O Validador de URL Completo (com Redirect Chain)

```javascript
async function validateUrl(urlString) -> Promise<{
  status: 'allowed' | 'blocked',
  reason: string | null,
  sanitizedUrl: string | null
}>
```

**Lógica interna (pseudocódigo):**

1. **Normalizar:** `new URL(urlString)` — WHATWG URL API faz parsing canônico, rejeitando URLs malformadas.
   - Remover credenciais embutidas: `url.username = ''; url.password = '';`
   - Forçar protocolo: se ausente, prefixar `https://`.
2. **Validar protocolo:** Só permite `http:` e `https:`. Bloquear `file:`, `gopher:`, `ftp:`, `data:`, `javascript:`, `jar:`, `dict:`, `smb:`.
3. **Validar hostname:** Bloquear se em `BLOCKED_HOSTNAMES`. Bloquear se hostname for um IP literal privado (ex: `http://127.0.0.1/`). Bloquear se hostname contiver `@` (credential smuggling).
4. **Resolver DNS:** `await dns.promises.lookup(hostname, { all: true })`. Para cada IP retornado, verificar `isBlockedIP(ip, family)`. Se qualquer IP for bloqueado, rejeitar com `status: 'blocked'`.
   - **Timeout DNS:** Envolver `dns.promises.lookup` em `Promise.race` com timeout de 5000ms. Se timeout, rejeitar com "DNS resolution timeout".
5. **Se aprovado**, retornar `{ status: 'allowed', sanitizedUrl: url.href }`.

#### 2.5 — Integração com o validateAction Existente

Adicionar ao `validateAction` atual um novo case:

```javascript
case 'buscarPagina':
case 'pesquisarWeb':
  const urlValidation = await validateUrl(params.url);
  if (urlValidation.status === 'blocked') {
    return { status: 'blocked', reason: `SSRF: ${urlValidation.reason}` };
  }
  params.url = urlValidation.sanitizedUrl;
  return { status: 'allowed', sanitizedParams: params };
```

**Explicação didática:** O `securityLayer` agora atua como guardião de rede. Qualquer tool que precise acessar a internet (`buscarPagina`, `pesquisarWeb`) passa pela validação SSRF antes de iniciar qualquer requisição. Isso garante que mesmo que o LLM alucine uma URL maliciosa, o agente jamais fará a requisição.

#### 2.6 — Ameaças Mitigadas (Tabela Didática)

| Ameaça | Exemplo | Como o securityLayer bloqueia |
|--------|---------|-------------------------------|
| Acesso a localhost | `http://127.0.0.1:11434/api/generate` | IP `127.0.0.1` está em `BLOCKED_IPV4_RANGES` (loopback) |
| Acesso a cloud metadata | `http://169.254.169.254/latest/meta-data/` | IP `169.254.169.254` está em `BLOCKED_IPV4_RANGES` (link-local) |
| DNS Rebinding | hostname que alterna entre IP público e `10.0.0.1` | `dns.lookup` retorna todos os IPs; se algum for privado, bloqueia |
| Redirect para IP interno | URL pública redireciona (301) para `http://127.0.0.1/admin` | Checagem SSRF em cada redirect da cadeia |
| IPv6-mapped IPv4 | `http://[::ffff:127.0.0.1]/` | `::ffff:0:0/96` está em `BLOCKED_IPV6_RANGES` |
| Octal/Hex IP | `http://0177.00.00.01/` | WHATWG URL API rejeita IPs octais; `new URL()` lança erro |
| Credential smuggling | `http://user:pass@evil.com@internal.local/` | WHATWG URL API extrai corretamente hostname como `internal.local`; credenciais são removidas |
| Protocol smuggling | `file:///etc/passwd` | Apenas `http:` e `https:` são permitidos |
| URL com backslash | `http://example.com\@127.0.0.1/` | WHATWG URL API normaliza |

---

### Passo 3: O Scraper de Página Única

**Ação:** Ferramenta que recebe uma URL, busca a página, extrai o texto relevante e retorna sanitizado.

**Arquivo:** `/src/tools/webScraper.js` — exporta `{ buscarPagina }`

#### 3.1 — Contrato Canônico

```javascript
async function buscarPagina(url) -> Promise<{
  success: boolean,
  data?: {
    url: string,
    titulo: string | null,
    conteudo: string,
    tamanhoOriginal: number,
    tamanhoExtraido: number
  },
  error?: string
}>
```

#### 3.2 — Lógica Interna

1. **Validação de URL com securityLayer:**
   ```javascript
   const { validateUrl } = require('../core/securityLayer');
   const urlCheck = await validateUrl(url);
   if (urlCheck.status !== 'allowed') {
     return { success: false, error: `URL bloqueada: ${urlCheck.reason}` };
   }
   const safeUrl = urlCheck.sanitizedUrl;
   ```

2. **Configuração do Crawlee (Uso Único):**
   ```javascript
   const { CheerioCrawler, Configuration, purgeDefaultStorages, log } = require('crawlee');
   
   // ⚠️ CRÍTICO: persistStorage: false → storage em memória, sem sujeira no disco
   const config = new Configuration({
     persistStorage: false,
     purgeOnStart: false,        // Não limpar storage no start (já está em memória)
     logLevel: 'OFF',            // Silencioso por padrão
   });
   ```

   **Por que `persistStorage: false`?** Crawlers Crawlee salvam estado (RequestQueue, Dataset, KeyValueStore) no diretório `./storage` por padrão. Com `persistStorage: false`, tudo fica em memória, ideal para Lambda/cloud functions e para nosso uso de tool única. Após o uso, `purgeDefaultStorages()` limpa qualquer resquício.

3. **Opções do CheerioCrawler:**
   ```javascript
   let resultado = null;
   let errorMsg = null;

   const crawler = new CheerioCrawler({
     // Concorrência: só 1 requisição (uso único)
     minConcurrency: 1,
     maxConcurrency: 1,

     // Timeout agressivo: se a página demorar mais de 25s, abortar
     requestHandlerTimeoutSecs: 25,
     navigationTimeoutSecs: 15,

     // Retry: no máximo 1 retry em caso de falha
     maxRequestRetries: 1,
     maxRequestsPerCrawl: 1,

     // ⚠️ Status codes 403 (Forbidden) e 503 (Service Unavailable) → tratar como erro
     // Crawlee por padrão NÃO retry em CheerioCrawler com retryOnBlocked para 403 (bug conhecido)
     // Portanto, forçamos via additionalHttpErrorStatusCodes
     additionalHttpErrorStatusCodes: [403, 503, 429],
     
     // ⚠️ Manter followRedirects: true (padrão) para seguir redirects
     // MAS, validar a URL de destino com SSRF ANTES de seguir
     // (O CheerioCrawler segue redirects automaticamente; a validação SSRF prévia
     //  é a primeira linha de defesa. Para defesa em profundidade, usamos 
     //  preNavigationHooks para validar redirects também.)

     // Headers realistas para evitar bloqueio (User-Agent de browser desktop)
     additionalMimeTypes: ['text/plain', 'application/json'],
     
     requestHandler: async ({ request, $, response }) => {
       // Verificar Content-Type
       const contentType = response?.headers?.['content-type'] || '';
       const isHTML = contentType.includes('text/html') || 
                      contentType.includes('application/xhtml+xml');
       const isText = contentType.includes('text/plain');
       const isJSON = contentType.includes('application/json');
       
       if (!isHTML && !isText && !isJSON) {
         errorMsg = `Tipo de conteúdo não suportado: ${contentType}. Apenas HTML, texto e JSON são aceitos.`;
         return;
       }

       // Verificar tamanho do corpo (antes de extrair)
       const bodySize = response?.body?.length || 0;
       const maxBytes = 5 * 1024 * 1024; // 5 MB máximo
       if (bodySize > maxBytes) {
         errorMsg = `Página muito grande (${(bodySize / 1024 / 1024).toFixed(1)} MB). Máximo: 5 MB.`;
         return;
       }

       try {
         const titulo = $('title').first().text().trim() || null;
         
         // Remover elementos indesejados ANTES de extrair texto
         REMOVE_SELECTORS.forEach(selector => {
           try { $(selector).remove(); } catch (e) { /* ignora seletor inválido */ }
         });

         // Extrair texto do <body>
         const bodyText = $('body').text();
         
         // Sanitizar
         let textoLimpo = cleanExtractedText(bodyText);
         
         // Truncar
         const MAX_CHARS = config.web?.max_extracted_chars || 15000;
         if (textoLimpo.length > MAX_CHARS) {
           textoLimpo = textoLimpo.slice(0, MAX_CHARS);
           const lastSpace = textoLimpo.lastIndexOf(' ');
           if (lastSpace > MAX_CHARS * 0.8) {
             textoLimpo = textoLimpo.slice(0, lastSpace);
           }
           textoLimpo += `\n\n[TEXTO TRUNCADO. Máximo de ${MAX_CHARS} caracteres atingido.]`;
         }
         
         resultado = {
           url: request.loadedUrl || request.url,
           titulo,
           conteudo: textoLimpo,
           tamanhoOriginal: bodySize,
           tamanhoExtraido: textoLimpo.length
         };
       } catch (parseError) {
         errorMsg = `Erro ao parsear HTML: ${parseError.message}`;
       }
     },

     // Handler para requisições que falharam após todos os retries
     failedRequestHandler: async ({ request }, error) => {
       // Classificar o erro para mensagem amigável
       if (error.message?.includes('timeout')) {
         errorMsg = `Timeout ao acessar ${request.url}: o site demorou mais de 25 segundos para responder.`;
       } else if (error.message?.includes('403') || error.message?.includes('Forbidden')) {
         errorMsg = `Acesso negado (403) a ${request.url}: o site bloqueou a requisição. Possível proteção Cloudflare.`;
       } else if (error.message?.includes('503') || error.message?.includes('Service Unavailable')) {
         errorMsg = `Serviço indisponível (503) em ${request.url}: o site pode estar sobrecarregado.`;
       } else if (error.message?.includes('ENOTFOUND') || error.message?.includes('DNS')) {
         errorMsg = `Host não encontrado: ${request.url}. Verifique a URL.`;
       } else {
         errorMsg = `Falha ao acessar ${request.url}: ${error.message}`;
       }
     },
   }, config);
   ```

4. **Configuração do storage_dir para isolamento:**
   ```javascript
   // Antes de rodar o crawler, definir o diretório de storage para um local
   // que não polua o diretório raiz com ./storage
   const tempDir = path.join(config.seguranca?.workdir || process.cwd(), 'temp_workspace', 'crawlee_storage');
   process.env.CRAWLEE_STORAGE_DIR = tempDir;
   ```
   A variável de ambiente `CRAWLEE_STORAGE_DIR` define onde Crawlee persiste dados. Apontar para `temp_workspace/crawlee_storage` para centralizar a sujeira.

5. **Execução:**
   ```javascript
   await crawler.run([safeUrl]);
   ```

6. **Limpeza (Cleanup — Obrigatória):**
   ```javascript
   // Limpar storages usados
   try {
     await purgeDefaultStorages({ onlyPurgeOnce: true });
   } catch (purgeError) {
     console.warn('[WEB_SCRAPER] purgeDefaultStorages falhou:', purgeError.message);
   }

   // Remover diretório de storage se existir
   try {
     if (fs.existsSync(tempDir)) {
       fs.rmSync(tempDir, { recursive: true, force: true });
     }
   } catch (cleanupError) {
     console.warn('[WEB_SCRAPER] cleanup de storage_dir falhou:', cleanupError.message);
   }
   ```
   **Por que isso é crítico:** Sem limpeza, cada execução deixaria ~500 KB a 2 MB de arquivos no disco. Em 1000 execuções, seriam até 2 GB de lixo acumulado. `purgeDefaultStorages()` limpa o storage local; `fs.rmSync` remove o diretório inteiro.

7. **Retorno:**
   ```javascript
   if (errorMsg) {
     return { success: false, error: errorMsg };
   }
   if (!resultado || !resultado.conteudo) {
     return { success: false, error: 'Nenhum conteúdo extraído da página.' };
   }
   return { success: true, data: resultado };
   ```

#### 3.3 — Tabela de Edge Cases (O que pode dar errado?)

| Cenário | Exemplo | Comportamento Esperado |
|---------|---------|------------------------|
| Site bloqueia com 403 | Cloudflare em frente ao site | `errorMsg`: "Acesso negado (403). Possível proteção Cloudflare." |
| Site retorna 503 | Servidor sobrecarregado | `errorMsg`: "Serviço indisponível (503)." |
| Timeout de rede | Site demora >25s para responder | `errorMsg`: "Timeout ao acessar URL." |
| DNS não resolve | Domínio inexistente | `errorMsg`: "Host não encontrado. Verifique a URL." |
| Resposta é PDF | `Content-Type: application/pdf` | `errorMsg`: "Tipo de conteúdo não suportado. Apenas HTML, texto e JSON." |
| Resposta é binário 50 MB | Download de arquivo ISO | `errorMsg`: "Página muito grande (50.0 MB). Máximo: 5 MB." |
| HTML sem `<body>` | Resposta mínima | Retorna texto extraído ou string vazia (não quebra) |
| HTML com caracteres inválidos | ISO-8859-1 mal declarado | Cheerio lida com encoding; `$('body').text()` converte |
| URL com fragmento | `https://site.com/page#section` | WHATWG URL API preserva; CheerioCrawler faz GET sem fragmento |
| Redirect para IP interno | URL → 301 → `http://127.0.0.1/` | SSRF via securityLayer validateUrl bloqueia na validação prévia |

---

### Passo 4: A Ferramenta de Pesquisa Web

**Ação:** Ferramenta que pesquisa no DuckDuckGo, coleta os links dos resultados, busca o conteúdo de cada um (via `webScraper.buscarPagina`), e retorna um agregado para o LLM.

**Arquivo:** `/src/tools/webSearch.js` — exporta `{ pesquisarWeb }`

#### 4.1 — Contrato Canônico

```javascript
async function pesquisarWeb(query, maxResults = 3) -> Promise<{
  success: boolean,
  data?: {
    query: string,
    resultados: Array<{
      titulo: string,
      url: string,
      snippet: string,
      conteudo?: string,
      erro?: string
    }>
  },
  error?: string
}>
```

#### 4.2 — Lógica Interna

1. **Validação SSRF da URL de busca:**
   ```javascript
   const { validateUrl } = require('../core/securityLayer');
   const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
   const urlCheck = await validateUrl(searchUrl);
   if (urlCheck.status !== 'blocked') { /* prossegue */ }
   ```

2. **URL de busca — DuckDuckGo Static:**
   - Usar `https://html.duckduckgo.com/html/?q=<QUERY_ENCODED>` — a versão estática que não requer JavaScript.
   - A versão dinâmica (`https://duckduckgo.com/?q=...`) requer JavaScript e não funciona com CheerioCrawler.
   - Headers essenciais para evitar 403:
     ```javascript
     User-Agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
     ```

3. **Seletores DuckDuckGo para Cheerio:**
   ```javascript
   const RESULT_SELECTOR = '#links .result';          // Container de cada resultado
   const TITLE_SELECTOR = '.result__a';               // Título + link
   const SNIPPET_SELECTOR = '.result__snippet';       // Descrição/snippet
   const URL_SELECTOR = '.result__url';               // URL de exibição
   ```
   **Referência:** Bright Data 2025: DuckDuckGo static HTML usa `#links .result` como container, `.result__a` para título/URL, `.result__snippet` para snippet, `.result__url` para URL de exibição.

4. **Extração da URL real (⚠️ Crítico):**
   - O atributo `href` do link no HTML bruto vem no formato: `//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite.com%2F...`
   - É necessário extrair o parâmetro `uddg` da URL de redirect e fazer `decodeURIComponent` para obter a URL real.
   ```javascript
   function extractRealUrl(ddgHref) {
     const fullUrl = 'https:' + ddgHref; // prefixar protocolo
     const parsed = new URL(fullUrl);
     const uddg = parsed.searchParams.get('uddg');
     return uddg ? decodeURIComponent(uddg) : null;
   }
   ```
   **Explicação didática:** O DuckDuckGo não expõe a URL final diretamente no HTML; ela fica ofuscada dentro de um link de rastreamento (`//duckduckgo.com/l/?uddg=...`). Extrair o parâmetro `uddg` revela a URL real de destino.

5. **Pipeline de processamento:**
   - Crawlear `html.duckduckgo.com/html/?q=...` → extrair lista de resultados (título, URL real, snippet)
   - Limitar a `maxResults` resultados (default: 3, máximo: 5)
   - **Etapa 1 (Speed Search):** Retornar imediatamente os snippets e links sem buscar conteúdo completo (latência ~1-2s). O LLM pode decidir se precisa de mais detalhes.
   - **Etapa 2 (Deep Fetch — sob demanda):** Se o LLM solicitar (via tool call subsequente indicando uma URL específica), buscar o conteúdo completo da página com `buscarPagina()`.

   **Fallback de seletores:** Se o seletor primário (`#links .result`) retornar 0 resultados, tentar seletores alternativos: `div.result`, `.result__body`, `article[data-testid="result"]`. As estruturas HTML do DuckDuckGo podem mudar sem aviso; ter fallbacks evita quebra total.

6. **Estrutura do CheerioCrawler para DuckDuckGo:**
   ```javascript
   const crawler = new CheerioCrawler({
     minConcurrency: 1,
     maxConcurrency: 1,
     requestHandlerTimeoutSecs: 20,
     navigationTimeoutSecs: 10,
     maxRequestRetries: 1,
     maxRequestsPerCrawl: 1,
     additionalHttpErrorStatusCodes: [403, 503, 429],
     
     requestHandler: async ({ $, request, log }) => {
       // Verificar se a página retornou resultados
       const noResults = $('.no-results, .msg--no-results').length > 0;
       if (noResults) {
         errorMsg = 'Nenhum resultado encontrado para esta consulta.';
         return;
       }
       
       const resultados = [];
       $(RESULT_SELECTOR).each((i, el) => {
         if (resultados.length >= maxResults) return false;
         
         const $el = $(el);
         const titleEl = $el.find(TITLE_SELECTOR).first();
         const snippetEl = $el.find(SNIPPET_SELECTOR).first();
         
         const ddgHref = titleEl.attr('href');
         const urlReal = ddgHref ? extractRealUrl(ddgHref) : null;
         
         if (urlReal && titleEl.text().trim()) {
           resultados.push({
             titulo: titleEl.text().trim(),
             url: urlReal,
             snippet: snippetEl.text().trim() || '(sem descrição)',
           });
         }
       });
       
       if (resultados.length === 0) {
         errorMsg = 'Não foi possível extrair resultados da página de busca. A estrutura do DuckDuckGo pode ter mudado.';
         return;
       }
       
       resultadosExtraidos = resultados;
     },
     
     failedRequestHandler: async ({ request }, error) => {
       // Mesma classificação de erros do webScraper
       errorMsg = classificarErro(request.url, error);
     },
   }, config);
   ```

7. **Retorno:**
   ```javascript
   if (errorMsg) return { success: false, error: errorMsg };
   return {
     success: true,
     data: {
       query,
       resultados: resultadosExtraidos,
       sugestao: 'Use buscarPagina com uma das URLs acima para obter o conteúdo completo.'
     }
   };
   ```

---

### Passo 5: Integração com o ToolManager

**Ação:** Registrar as novas ferramentas no roteador de ferramentas da Fase 3.

**Arquivo a modificar:** `/src/tools/toolManager.js`

Adicionar ao `toolMap` existente:

```javascript
const webScraper = require('./webScraper');
const webSearch = require('./webSearch');

const toolMap = {
  // ... ferramentas existentes da Fase 3 ...
  buscarPagina: webScraper.buscarPagina,
  pesquisarWeb: webSearch.pesquisarWeb,
};
```

Adicionar no `securityLayer.validateAction`:

```javascript
case 'buscarPagina':
  return validateUrlAndParams(params, ['url']);
case 'pesquisarWeb':
  return validateSearchParams(params);
```

---

### Passo 6: Validação Isolada — Script de Teste de Acesso Web

**Ação:** Script para testar o scraper e a pesquisa web independentemente do WhatsApp e LLM.

**Arquivo:** `/TMP_SCRIPTS/test_web_access.js`

#### 6.1 — Cabeçalho Obrigatório

```javascript
/**
 * TMP_SCRIPTS/test_web_access.js
 *
 * PROPÓSITO: Validar a camada de acesso web (webScraper + webSearch + securityLayer SSRF)
 *            independentemente do WhatsApp e do LLM.
 *
 * COMO EXECUTAR: node TMP_SCRIPTS/test_web_access.js
 *
 * O QUE VALIDA:
 *   1. buscarPagina com URL pública (ex: example.com) → sucesso
 *   2. buscarPagina com URL localhost → bloqueado por SSRF
 *   3. buscarPagina com URL de IP privado → bloqueado por SSRF
 *   4. pesquisarWeb com query simples ("Node.js") → sucesso, retorna resultados com snippets
 *   5. pesquisarWeb com query vazia → erro tratado
 *   6. buscarPagina com URL inexistente → erro tratado (ENOTFOUND)
 *   7. buscarPagina com redirect para IP interno → bloqueado por SSRF (se implementado)
 *   8. Conteúdo extraído é sanitizado (sem <script>, <style>, etc.)
 *   9. Limpeza de storage após execução
 */
```

#### 6.2 — Lógica do Script de Teste

```javascript
const { buscarPagina } = require('../src/tools/webScraper');
const { pesquisarWeb } = require('../src/tools/webSearch');

const TEST_CASES = [
  {
    nome: 'buscarPagina: URL pública válida',
    fn: () => buscarPagina('https://example.com'),
    esperado: (r) => r.success && r.data.conteudo.length > 0,
  },
  {
    nome: 'buscarPagina: localhost (SSRF)',
    fn: () => buscarPagina('http://127.0.0.1:8080/admin'),
    esperado: (r) => !r.success && /bloqueada|SSRF/i.test(r.error || ''),
  },
  {
    nome: 'buscarPagina: IP privado (SSRF)',
    fn: () => buscarPagina('http://192.168.1.1/'),
    esperado: (r) => !r.success && /bloqueada|SSRF/i.test(r.error || ''),
  },
  {
    nome: 'buscarPagina: URL inexistente',
    fn: () => buscarPagina('https://this-domain-definitely-does-not-exist-12345.com'),
    esperado: (r) => !r.success,
  },
  {
    nome: 'pesquisarWeb: query simples',
    fn: () => pesquisarWeb('Node.js event loop', 2),
    esperado: (r) => r.success && Array.isArray(r.data?.resultados) && r.data.resultados.length > 0,
  },
  {
    nome: 'pesquisarWeb: query vazia',
    fn: () => pesquisarWeb(''),
    esperado: (r) => !r.success,
  },
  {
    nome: 'buscarPagina: sanitização HTML',
    fn: async () => {
      const r = await buscarPagina('https://example.com');
      if (!r.success) return false;
      // Verifica que conteúdo NÃO contém tags script/style
      const temScript = /<script\b/i.test(r.data.conteudo);
      const temStyle = /<style\b/i.test(r.data.conteudo);
      return !temScript && !temStyle;
    },
    esperado: (r) => r === true,
  },
];

(async () => {
  let passou = 0, falhou = 0;
  
  for (const caso of TEST_CASES) {
    try {
      const resultado = await caso.fn();
      const ok = caso.esperado(resultado);
      console.log(`${ok ? '✅' : '❌'} ${caso.nome}`);
      if (ok) passou++; else {
        falhou++;
        console.log(`   Esperado: ${caso.esperado.toString().slice(0, 80)}...`);
        console.log(`   Obtido:   ${JSON.stringify(resultado).slice(0, 120)}...`);
      }
    } catch (err) {
      console.log(`❌ ${caso.nome} (exceção: ${err.message})`);
      falhou++;
    }
  }
  
  console.log(`\n${passou}/${TEST_CASES.length} passaram, ${falhou} falharam`);
  
  // Cleanup final: garantir que diretório de storage foi limpo
  const fs = require('fs');
  const path = require('path');
  const tempDir = path.join(process.cwd(), 'temp_workspace', 'crawlee_storage');
  if (fs.existsSync(tempDir)) {
    console.log(`⚠️  Diretório de storage ainda existe: ${tempDir}`);
  } else {
    console.log('✅ Diretório de storage limpo com sucesso.');
  }
  
  process.exit(falhou > 0 ? 1 : 0);
})();
```

**Observações importantes sobre o teste:**

- O primeiro teste (`example.com`) é o "smoke test": se ele falhar, há um problema fundamental na configuração do Crawlee ou na rede.
- Os testes SSRF são a validação de segurança mais crítica — se falharem, o agente teria acesso a recursos internos.
- O último teste verifica a sanitização: o conteúdo extraído **não deve conter** tags `<script>` ou `<style>`.

---

## Gestão de Estado e Sujeira no Disco

### Problema

Crawlee, por padrão, cria o diretório `./storage` no CWD (current working directory) do processo Node.js e persiste os estados de RequestQueue, Dataset e KeyValueStore em disco. Para um agente que pode executar centenas de buscas ao longo de semanas, isso acumularia gigabytes de arquivos JSON residuais.

### Solução em 3 Camadas

1. **`persistStorage: false`:** Passado via `new Configuration({ persistStorage: false })` ao construtor do CheerioCrawler. Isso faz o crawler usar `MemoryStorage` em vez de `StorageLocal`, mantendo tudo em RAM.
2. **`CRAWLEE_STORAGE_DIR`:** Redirecionar o storage para `temp_workspace/crawlee_storage` via variável de ambiente, isolando a sujeira em um local conhecido e limpo.
3. **`purgeDefaultStorages()` + `fs.rmSync`:** Após cada execução, limpar o storage via API do Crawlee e, como garantia adicional, remover o diretório inteiro com `fs.rmSync({ recursive: true, force: true })`.

### Verificação Periódica (Opcional para Fase 5)

Se desejar, um Cron Job diário pode verificar o tamanho de `temp_workspace/crawlee_storage` e limpá-lo se ultrapassar X MB.

---

## Restrição de Rede (Hostnames Dinâmicos)

Toda comunicação de rede **interna** (LLM, webhooks, futuros microsserviços) deve usar hostnames cadastrados no `config.json`, nunca IPs fixos. A resolução DNS dinâmica garante que o agente funcione mesmo após mudanças de IP (comuns em ambientes domésticos ou com Tailscale).

O `securityLayer.js` da Fase 3 já valida que comandos de sistema não usem IPs internos. O novo módulo SSRF desta fase complementa essa proteção no plano da rede HTTP.

---

## Dependências Novas (Resumo)

| Pacote | Versão | Propósito |
|--------|--------|-----------|
| `crawlee` | ^3.13 | Motor de crawling HTTP + parse Cheerio |
| `cheerio` | ^1.0 | Biblioteca de parse HTML (jQuery-like) |

---

## Estrutura de Diretórios ao Final da Fase 4

```text
/the-a-gent
│
├── /src
│   ├── /core
│   │   └── securityLayer.js      ← ATUALIZADO (nova validação SSRF)
│   ├── /tools
│   │   ├── fileSystem.js         (Fase 3)
│   │   ├── osCommands.js         (Fase 3)
│   │   ├── toolManager.js        ← ATUALIZADO (novas tools)
│   │   ├── webScraper.js         ← NOVO (Passo 3)
│   │   └── webSearch.js          ← NOVO (Passo 4)
│   └── /utils
│       └── htmlSanitizer.js      ← NOVO (funções removeSelectors, cleanText)
│
├── /TMP_SCRIPTS
│   └── test_web_access.js        ← NOVO (Passo 6)
│
├── /temp_workspace
│   └── crawlee_storage/          ← TEMPORÁRIO (limpo automaticamente)
│
├── config.json                   ← ATUALIZADO (nova seção "web")
└── package.json                  ← ATUALIZADO (crawlee, cheerio)
```

---

## Contratos de Exportação (Fase 4)

| Módulo | Exportação | Arquivo |
|--------|-----------|---------|
| securityLayer | `{ validateAction, validateUrl }` | `/src/core/securityLayer.js` |
| webScraper | `{ buscarPagina }` | `/src/tools/webScraper.js` |
| webSearch | `{ pesquisarWeb }` | `/src/tools/webSearch.js` |
| toolManager | `{ executeToolCall }` | `/src/tools/toolManager.js` |
| htmlSanitizer | `{ REMOVE_SELECTORS, cleanExtractedText }` | `/src/utils/htmlSanitizer.js` |

---

## CHECKLIST OBRIGATÓRIO DE ARQUITETURA (Fase 4)

### Segurança SSRF
- [ ] `securityLayer.validateUrl` normaliza via WHATWG `new URL()`.
- [ ] Protocolos permitidos: apenas `http:` e `https:`. Bloquear `file:`, `gopher:`, `data:`, `javascript:`, etc.
- [ ] Credenciais embutidas removidas (`url.username = ''; url.password = ''`).
- [ ] `BLOCKED_HOSTNAMES` inclui `localhost`, `localhost.localdomain`, `metadata.google.internal`, `169.254.169.254`.
- [ ] DNS lookup via `dns.promises.lookup` com timeout de 5000ms.
- [ ] Classificação de IP contra `BLOCKED_IPV4_RANGES` (RFC1918, loopback, link-local, multicast, TEST-NET) e `BLOCKED_IPV6_RANGES` (loopback, link-local, unique local, multicast, IPv4-mapped).
- [ ] Checagem SSRF em redirects (301/302/307/308) — cada destino validado antes de seguir.
- [ ] Integração com `validateAction` para `buscarPagina` e `pesquisarWeb`.

### Sanitização
- [ ] `REMOVE_SELECTORS` inclui: `script`, `style`, `svg`, `canvas`, `iframe`, `img[src^="data:"]`, `meta`, `nav`, `footer`, `header`, `[hidden]`, `[aria-hidden]`, `template`.
- [ ] Comentários HTML removidos (`<!-- ... -->`).
- [ ] Whitespace normalizado (3+ quebras de linha → 2).
- [ ] Truncamento configurável em `max_extracted_chars` (default 15000).
- [ ] Truncamento inteligente (no último espaço antes do limite).

### Crawlee
- [ ] `persistStorage: false` via `new Configuration()`.
- [ ] `CRAWLEE_STORAGE_DIR` apontando para `temp_workspace/crawlee_storage`.
- [ ] `requestHandlerTimeoutSecs` configurado (25s para scrape, 20s para busca).
- [ ] `navigationTimeoutSecs` configurado (15s para scrape, 10s para busca).
- [ ] `maxRequestRetries: 1`.
- [ ] `maxRequestsPerCrawl: 1` (uso único por tool call).
- [ ] `additionalHttpErrorStatusCodes: [403, 503, 429]`.
- [ ] `failedRequestHandler` com classificação de erros (timeout, 403, 503, DNS).
- [ ] `purgeDefaultStorages({ onlyPurgeOnce: true })` após execução.
- [ ] `fs.rmSync(tempDir, { recursive: true, force: true })` no finally.

### DuckDuckGo
- [ ] URL base: `https://html.duckduckgo.com/html/?q=<ENCODED>`.
- [ ] Seletor de resultados: `#links .result`.
- [ ] Seletor de título/URL: `.result__a`.
- [ ] Seletor de snippet: `.result__snippet`.
- [ ] Extração da URL real via parâmetro `uddg` + `decodeURIComponent`.
- [ ] Prefixo `https:` para hrefs iniciados com `//`.

### Tool Manager
- [ ] `buscarPagina` registrada com validação SSRF prévia.
- [ ] `pesquisarWeb` registrada com validação SSRF prévia.
- [ ] Parâmetro `url` sanitizado antes da execução.

### Script de Teste
- [ ] Cobre: URL pública válida, localhost (SSRF), IP privado (SSRF), URL inexistente, query simples, query vazia, sanitização HTML, cleanup de storage.
- [ ] Timeout global de 60s no script de teste.

### Código e Estilo
- [ ] Todas as funções `async` expostas têm `try/catch` interno.
- [ ] Todos os `require` no topo (nativos como objeto completo, projeto com desestruturação).
- [ ] Cabeçalho explicativo em cada arquivo.
- [ ] `module.exports` no final de cada arquivo.
- [ ] Comentários arquiteturais explicando **por que**, não apenas **o que**.

---

**Status de Conclusão:** A Fase 4 estará concluída quando o usuário enviar pelo WhatsApp "Pesquise sobre os usos do Node.js e me traga um resumo". O The A-gent deve: validar a query contra SSRF → chamar `pesquisarWeb` → extrair resultados do DuckDuckGo HTML estático → retornar os snippets para o LLM → o LLM pode opcionalmente chamar `buscarPagina` para obter o conteúdo completo de uma URL → responder com um resumo formatado no WhatsApp. Além disso, tentativas de burlar a segurança (ex: "acesse http://127.0.0.1/admin") devem ser bloqueadas com uma mensagem clara: "URL bloqueada por política de segurança: SSRF". E após cada operação, o diretório `crawlee_storage` deve estar vazio.