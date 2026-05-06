Atue como um Staff/Principal Engineer e Especialista em Segurança (SecOps) focado em Node.js (Vanilla).

Estamos desenvolvendo o The A-gent, um agente autônomo local. Ele atua como uma ponte entre modelos de linguagem (Ollama local/Gemini nuvem) e o sistema operacional, operando via chamadas de função (Function Calling) com JSON estrito e interfaceado pelo WhatsApp (biblioteca Baileys).

Abaixo está o rascunho do nosso Plano de Ação - Fase 3: As Mãos, que é a camada responsável por abstrair o Sistema Operacional (File System e Comandos de Terminal).

Sua missão é revisar, filtrar e detalhar este plano com extrema severidade técnica. O objetivo não é mudar o escopo, mas sim blindar a arquitetura e aprofundar a lógica de implementação.

Ao revisar e detalhar o plano, você deve obrigatoriamente seguir estas diretrizes do nosso projeto:

Segurança em 1º Lugar: Pense como um atacante. Procure falhas de path traversal (ex: uso de symlinks para escapar do workdir), injeções de comando mascaradas em child_process.execFile e condições de corrida (race conditions) no fs. Refine a lógica da "Segurança Tri-State".

Explicação Didática: Sempre que você sugerir a geração de um novo código ou estrutura, você deve detalhar e explicar minuciosamente o que cada bloco ou linha crítica está fazendo. Jamais despeje código sem contexto.

Rede Dinâmica: O sistema roda em um ambiente com IP dinâmico. Todas as conexões de rede (APIs, bancos, LLMs locais) devem continuar sendo estruturadas via hostname, nunca por IP fixo. Garanta que a arquitetura respeite isso.

Modularidade (SRP): Respeite rigorosamente a responsabilidade única. Arquivos devem se manter entre 250 e 500 linhas. Não crie divisões artificiais; isole responsabilidades secundárias em funções utilitárias.

Depois edite o arquivo fase-3.md conforme necessário e não crie nenhum código novo ainda, pois estamos na fase de documentação dessa fase 3.