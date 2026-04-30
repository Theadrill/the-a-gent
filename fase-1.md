# Plano de Ação - Fase 1: O Cérebro (Core e Memória)

**Objetivo da Fase:** Estabelecer a comunicação base entre o Node.js e o modelo de IA (Ollama/Nuvem) usando hostnames, configurar o banco de dados SQLite para a memória de longo prazo, e garantir que a IA responda estritamente em formato JSON validado. 
**Importante:** Nesta fase NÃO haverá integração com WhatsApp ou execução de comandos no sistema operacional. Os testes serão feitos via terminal (`readline`).

---

## Instruções Críticas para o Agente Codificador (Antigravity/IA)
1. **Modularidade:** Respeite a árvore de diretórios do `plano_de_projeto.md`. Nenhum arquivo deve ultrapassar o *soft limit* de 250 lines.
2. **Explicação de Código:** Sempre que for gerar um novo código, mostre e explique detalhadamente o que cada parte/bloco do código está fazendo. Não jogue o código sem contexto.
3. **Rede:** A conexão deve ser via *hostname* (e não IP fixo), pois o IP é dinâmico.

---

## Roteiro de Execução (Passo a Passo)

A IA deve ser instruída a codificar este projeto estritamente na ordem abaixo, um passo por vez:

### Passo 1: Setup Inicial e Configurações
* **Ação:** Inicializar o projeto e criar as configurações estáticas.
* **Arquivos a criar:**
  1. `package.json`: Inicializar com `npm init -y` e adicionar apenas dependências essenciais (ex: `dotenv`, `sqlite3`).
  2. `config.json`: Criar o arquivo mestre com as configurações de API (Ollama/Gemini), caminhos de diretório e limites de memória.
  3. `.env` e `.env.example`: Criar as variáveis de ambiente base.

### Passo 2: O Banco de Dados (Memória SQLite)
* **Ação:** Construir o módulo responsável por salvar e ler o histórico de conversas, garantindo a retenção da memória de longo prazo.
* **Arquivos a criar:**
  1. `/src/memory/dbAdapter.js`: Script responsável por inicializar a conexão com o SQLite e criar a tabela `messages` (com `id`, `role`, `content`, `timestamp`) caso ela não exista.
  2. `/src/memory/memoryManager.js`: Script que expõe as funções para uso do sistema: `salvarMensagem()`, `buscarUltimasMensagens(limite_buffer)`, e `limparHistorico()`.

### Passo 3: O Cliente LLM (Conexão e Requisição)
* **Ação:** Construir o motor que envia e recebe dados da IA, lidando com a formatação.
* **Arquivos a criar:**
  1. `/src/core/promptBuilder.js`: Script que monta o *System Prompt* mestre, instruindo o modelo a responder SEMPRE em JSON estruturado, e injeta o histórico do SQLite na requisição.
  2. `/src/core/llmClient.js`: O motor HTTP (usando `fetch` nativo). Deve ler o `config.json` para pegar o hostname e a porta, enviar o *payload* montado para a API do Ollama e retornar a resposta. Se der erro (timeout), deve prever a lógica de fallback.

### Passo 4: Validação do "Cérebro" (Parser JSON)
* **Ação:** Blindar o Node.js contra respostas malformadas da IA ("alucinações" de formatação).
* **Arquivos a criar:**
  1. `/src/core/jsonExtractor.js`: Uma função utilitária pura que recebe a resposta em texto bruto da IA, encontra a primeira `{` e a última `}`, faz a extração e roda o `JSON.parse()`. Deve tratar erros de *parse* de forma elegante, retornando um erro limpo se falhar.

### Passo 5: O Maestro de Teste (Ponto de Entrada temporário)
* **Ação:** Unir todos os módulos criados para testar o sistema.
* **Arquivos a criar:**
  1. `index.js` (Raiz): Importar o banco de dados, o cliente LLM e o extrator JSON. Usar o módulo nativo `readline` do Node.js para criar um prompt simples no terminal. O usuário digita no terminal, o script salva no banco, envia pro LLM, extrai o JSON da resposta e imprime na tela.

---
**Status de Conclusão:** A Fase 1 estará concluída quando o usuário conseguir abrir o terminal, digitar "Olá, quem é você?", o Node.js enviar via hostname para o modelo local, e o terminal imprimir a resposta perfeitamente formatada em JSON, com o registro salvo no arquivo `.db`.
