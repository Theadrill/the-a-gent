# The A-gent 🕵️‍♂️

Um agente autônomo focado em programação e automação de sistema, construído estritamente em **Node.js (Vanilla JS)**. Sem frameworks engessados, sem consumo desnecessário de RAM. 

O The A-gent atuará como uma ponte entre modelos de linguagem locais (LLMs rodando via Ollama ou LM Studio) e o sistema operacional, utilizando *Function Calling* para executar comandos, editar arquivos e agendar tarefas, tudo controlado diretamente pela interface do WhatsApp.

## 🚀 Roadmap (Funcionalidades Planejadas)

* **Controle via WhatsApp:** Integração direta usando `@whiskeysockets/baileys` (WebSockets). Zero dependência de navegadores *headless* pesados.
* **Execução de Sistema:** Acesso total ao terminal via módulo nativo `child_process` para rodar comandos, gerenciar o Git e interagir com o ambiente de desenvolvimento.
* **Gestão de Arquivos:** Leitura e edição de código em tempo real através do módulo nativo `fs`.
* **Agendamento de Tarefas:** Criação e gerenciamento de rotinas (Cron Jobs) utilizando `node-cron`.
* **Recepção de Webhooks:** Servidor `express` enxuto para escutar eventos externos (ex: push no GitHub, gatilhos de automação).
* **Conexão Resiliente:** Toda a comunicação de rede e requisições para a IA local serão feitas exclusivamente via **hostname**, garantindo estabilidade mesmo em redes com IP dinâmico.

## 🧠 Arquitetura Alvo

O agente operará em um loop contínuo de Raciocínio -> Ação -> Observação:

1. O usuário envia uma mensagem pelo WhatsApp.
2. O Node.js intercepta, formata o histórico e envia para o LLM local.
3. Se a IA decide agir, ela responde com um objeto `JSON` estrito contendo a ferramenta e os parâmetros.
4. O Node.js executa a ação no sistema (`exec`, `fs`, `cron`) e devolve o resultado invisível para a IA analisar.
5. A IA gera a resposta final em linguagem natural, que é enviada de volta ao usuário via WhatsApp.

## 🛠️ Stack Tecnológica Definida

* **Linguagem:** JavaScript (Node.js Vanilla)
* **Mensageria:** Baileys (WhatsApp WebSockets)
* **Automação:** Node-cron
* **Webhooks:** Express.js
* **Processamento de IA:** LLM Local (via API HTTP padrão apontada para o hostname)

## 🚧 Setup e Instalação (Em Desenvolvimento)

*As instruções detalhadas de configuração de ambiente, pareamento do QR Code do WhatsApp e inicialização do servidor local serão documentadas aqui assim que os módulos base forem concluídos.*
