# Plano de Projeto: The A-gent

## 1. Visão Geral e Infraestrutura

O **The A-gent** é um agente autônomo projetado para atuar como um assistente de programação e automação, utilizando o modelo de "Cérebro Local/Nuvem" e "Mãos no Sistema".

- **Conectividade Resiliente:** Toda comunicação com a API do LLM deve utilizar Hostnames (via Tailscale ou DNS local) para mitigar problemas de IP dinâmico.
- **Acesso Remoto:** Configuração de `OLLAMA_HOST=0.0.0.0` para permitir conexões via rede virtual (Tailscale).
- **Provedores de IA:** Troca dinâmica entre Ollama (Local) e Google Gemini (Cloud API) via `config.json`.
- **Gestão de Segredos:** O projeto utiliza um arquivo `config.json` genérico para configurações estruturais (rotas, portas, diretórios) e um arquivo `.env` estrito para chaves privadas (ex: chaves de API da nuvem). O arquivo `.env` jamais deve ser comitado (adicionar ao `.gitignore`), mantendo apenas um `env.example` no repositório.
- **Fallback de LLM (Alta Disponibilidade):** O sistema deve possuir um mecanismo de tolerância a falhas na ponte de rede. A requisição HTTP tenta primariamente bater no modelo Local (Ollama/LM Studio). Em caso de *timeout* ou recusa de conexão, o Node.js aciona automaticamente o provedor de Nuvem secundário (ex: API do Gemini), garantindo que o agente nunca fique offline.

## 2. O Cérebro: Memória e Raciocínio

A comunicação entre o Node.js e a IA é baseada em **Function Calling** via JSON extraído.

- **Gestão de Memória Híbrida:**
  1. **Buffer de Curto Prazo:** Mantém as últimas X mensagens para contexto imediato.
  2. **Memória de Médio Prazo:** Resumos automáticos ao atingir o limite de tokens.
  3. **Memória de Longo Prazo (SQLite):** Interações salvas em `./data/agent_memory.db`.

## 3. A Interface e Orquestração

- **Interface Base:** Biblioteca `@whiskeysockets/baileys` (WebSockets).
- **Persistência de Sessão:** Salva autenticação em `./auth_info` (Zero re-escaneamento).
- **Orquestrador de Mídia:**
  - Áudio: Whisper.
  - Imagens: OCR local ou LLM de Visão.
  - Arquivos: Extração de texto para contexto.

## 4. As Mãos: Camada "DirectX" (Execução)

Abstração total do Sistema Operacional.

- **Abstração de Comandos:** Ações lógicas traduzidas para funções nativas (fs, child_process).
- **Segurança Tri-State:**
  1. **Whitelist:** Execução silenciosa.
  2. **Blacklist:** Bloqueio de pastas sensíveis e comandos perigosos.
  3. **Confirmação:** Pedido de aprovação via WhatsApp para áreas cinzentas.
- **Execução Segura de Processos:** Quando o uso do terminal nativo for estritamente necessário, o Node.js deve priorizar o uso de `child_process.execFile` em vez de `child_process.exec`. Isso mitiga falhas de injeção de comandos acidentais caso a IA gere strings malformadas, mantendo os argumentos isolados do comando principal.

## 5. O Relógio: Automação e Boot

- **Agendador:** `node-cron` com configurações no SQLite.
- **Re-hidratação:** Leitura automática do banco de dados ao iniciar o Node.js.
- **Webhooks:** Servidor Express em porta dedicada para gatilhos externos.
- **Backup Automático de Memória:** Implementação de um *Cron Job* nativo diário que executa o dump de segurança do banco SQLite (`sqlite3 ./data/agent_memory.db .dump > ./data/backups/backup_data.sql`), protegendo a memória de longo prazo do agente contra corrupção de arquivos.

## 6. Padronização do Projeto (Modularidade e Responsabilidade)

⚠️ **REGRA CRÍTICA PARA GERAÇÃO DE CÓDIGO (Modularidade e Responsabilidade):** O princípio absoluto a ser seguido é o da Responsabilidade Única (SRP), e não um contador cego de linhas.

- **A Meta (Soft Limit):** Estruture os módulos de forma que a maioria fique entre 250 e 500 linhas para facilitar a leitura.

- **A Exceção (Coesão):** Se um módulo for altamente coeso e precisar de mais linhas para cumprir sua única função sem gambiarras, ele deve ser mantido inteiro.
- **Proibição Absoluta:** É estritamente proibido criar divisões artificiais (ex: arquivo_part1.js, arquivo_part2.js).

Se um arquivo estiver ficando gigantesco, a IA deve primeiro avaliar: "Este arquivo está fazendo mais de uma coisa?". Se a resposta for sim (ex: um script que gerencia a rede E formata o texto), extraia a lógica secundária para um novo arquivo na pasta `/utils` ou `/core`. Se a resposta for não, apenas siga em frente com o código.

- **Plugins e Integrações:** Todas as integrações (WhatsApp, Telegram, etc.) devem obrigatoriamente residir na pasta `plugins`.

### Estrutura de Diretórios

```
/the-a-gent
│
├── /src
│   ├── /core           # O cérebro (Comunicação LLM, extração de JSON)
│   ├── /memory         # Lógica do SQLite e controle do buffer
│   ├── /plugins        # Integrações e Plugins de comunicação
│   │   └── /whatsapp   # Exclusivo para os plugins, como o Baileys (Conexão, listener)
│   ├── /tools          # As "Mãos". Um arquivo por tool (ex: fileSystem.js)
│   ├── /skills         # Capacidades de alto nível (comportamentos, módulos baixáveis)
│   ├── /orchestrator   # Lógica de roteamento de mídia (áudio, imagem, texto)
│   ├── /automation     # Relógio: node-cron e webhook express
│   └── /utils          # Funções auxiliares (logs, formatadores)
│
├── /data               # Arquivos locais (banco SQLite)
├── /temp_workspace     # Downloads temporários
├── /auth_info          # Sessão do WhatsApp
├── .env.example        # Template de variáveis secretas (Sem valores)
├── .env                # Variáveis secretas locais (NÃO COMITAR)
├── config.json         # Arquivo mestre de parâmetros
└── index.js            # Entry Point (Maestro)
```

## 7. Estrutura do config.json (Exemplo)

```json
{
  "api": { 
    "provider": "ollama", 
    "fallback_provider": "gemini",
    "hostname": "meu-pc-casa", 
    "port": 11434 
  },
  "memoria": { 
    "max_buffer": 15, 
    "db_path": "./data/agent_memory.db" 
  },
  "seguranca": { 
    "workdir": "C:/Projetos/Dev", 
    "confirmacao_ativa": true 
  }
}
```
