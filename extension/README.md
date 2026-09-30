# Extensão Chrome — Leitor de XML (Fisco Fácil)

Manifest V3. Opera o Fisco Fácil (SEFAZ-RJ) no navegador do colaborador, autenticado pelo certificado A1 local, consumindo as rotas `/api/leitorxml/extensao/*` do backend deste mesmo repositório.

## Carregar para teste

1. `chrome://extensions` → ativar "Modo do desenvolvedor" → "Carregar sem compactação" → selecionar esta pasta (`extension/`).
2. Clicar no ícone da extensão → preencher URL do backend (`http://localhost:3003/leitorxml` em dev) e o token (gerado em `POST /api/leitorxml/extensao/tokens`, autenticado com sessão do Portal — por enquanto só via `curl`/Postman, a tela de gerar token ainda não existe no Portal).
3. Com o Fisco Fácil acessível (certificado A1 carregado no Windows), clicar "Buscar próxima tarefa".

## Arquitetura

- `src/background.js` — service worker. Único lugar que fala com o backend (token, fetch). Mantém o estado da execução em `chrome.storage.session` (`activeRun`) e escuta `chrome.downloads` para capturar o ZIP quando uma solicitação está pronta. Também orquestra o modo descoberta de procuração (fila `discovery.queue`/`discovery.cursor` dentro do `activeRun`, avança via `history.back()` injetado com `chrome.scripting.executeScript`).
- `src/content-home.js` — roda em `ssacert.fazenda.rj.gov.br`. Abre "AUTO Fisco Fácil". Se a posição já é conhecida (índice ou cadastro manual), clica direto; se não, entra em **modo descoberta**: lista todas as posições do modal e testa uma por vez até achar o CNPJ alvo.
- `src/content-fisco.js` — roda em `fisco-facil.fazenda.rj.gov.br`. Detecta a página atual pelo `location.pathname` e executa a ação certa: lista de empresas (busca por CNPJ — em modo descoberta, "não encontrado" avisa o background pra tentar a próxima posição em vez de falhar), painel da empresa, formulário de extração, leitura da aba Solicitações.
- `src/dom-utils.js` — helpers compartilhados (espera de AJAX via `#loading`, clique/matching por texto).
- `popup/` — configuração de URL/token, disparo manual de "próxima tarefa" e status "Certificado conectado / Empresa selecionada" (lido de `chrome.storage.session.connectionStatus`, atualizado por `content-home.js`/`content-fisco.js` a cada carregamento de página, independente de haver tarefa em andamento).

## O que está confirmado (HTML real + gravação de tela, 2026-09-29)

- URLs reais: `ssacert.fazenda.rj.gov.br/ssa/certificadoWeb` → `fisco-facil.fazenda.rj.gov.br/SATI-FiscoFacil/privado/{principalContribuintes,mainAbasContribuinte,solicitacoes/solicitacaoExtracaoDfe}.xhtml`.
- Todos os IDs de campo do formulário de extração, da tabela de empresas (`FrmFisco:ListaContribuintes`, com busca por CNPJ) e da aba Solicitações (`frmHistInteracoes:tabsHist:solicitacao`).
- O clique na "Situação" de uma solicitação processada dispara o download do ZIP diretamente (não é um modal com botão dentro) — confirmado pelo usuário.
- `#modalAutorizacoes`/`#conteudoModalAutorizacoes` (IDs do modal "Escolha um perfil") e o nome do titular do certificado (`h6.text-body` dentro de `.area-user-login`) — confirmados via HTML real (`ssacert.fazenda.rj.gov.br/ssa/certificadoWeb`, salvo em 2026-09-29). Esse painel é hidratado por um componente Angular depois do carregamento inicial da página — `readCertificateHolderNameOnHome()` precisa de `waitFor()`, não pode ler de forma síncrona no load.
- Uma posição de procuração leva a uma **lista paginada com várias empresas** (visto ao vivo em 2026-09-30: 5+ empresas, "1 de 2" páginas), não uma empresa só — por isso o índice de procurações é `(grupo, posição, cnpj)`, não `(grupo, posição)`.
- `chrome.storage.session` não é acessível de content scripts por padrão (erro "Access to storage is not allowed from this context") — precisa de `chrome.storage.session.setAccessLevel({accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS"})` no `background.js`, toda vez que o service worker acorda.

## O que ainda é suposição — validar na PoC (Fase 2)

1. **Formato da data no formulário de extração.** O campo mostra "08/2026" na tela depois de escolher "Meses", mas não sabemos se é isso que o servidor espera receber, ou se só a exibição é resumida. Implementado setando esse valor direto via JS (sem navegar o calendário por clique) — se o servidor rejeitar, ajustar `formatCompetencia()` em `content-fisco.js`.
2. **Markup exato dentro de `#conteudoModalAutorizacoes` (links "Acesso por procuração").** O layout visual (print, 2026-09-29) bate com a heurística de `collectProcuracaoLinks()` em `content-home.js` (cabeçalho de grupo curto — ex. "SUBFIN" — seguido de vários links idênticos), mas o conteúdo é injetado via AJAX (`carregarAutorizacoes()`/`abrirModalAutorizacoes()`) e nunca foi capturado como HTML real (a página salva sempre pegou o modal fechado/vazio) — pode precisar ajuste fino de tag/classe.
3. ~~Índice de procurações não é descoberto automaticamente.~~ **Implementado em 2026-09-30**: se a posição não é conhecida (nem no índice `xml_watch_procuration_index`, nem preenchida à mão no cadastro), a extensão testa cada "Acesso por procuração" do modal em sequência (busca o CNPJ alvo na lista de cada uma, via `history.back()` entre tentativas) e cacheia a posição encontrada. Ainda não validado ao vivo contra um cenário com mais de uma procuração/grupo real — só contra uma.
4. **Certificado próprio (não por procuração) não está automatizado.** Trocar de certificado A1 ativo no navegador exige o seletor nativo do Windows/Chrome, que a extensão não consegue acionar sozinha — hoje ela só reporta "aguardando intervenção" pra esses casos.
5. **Captura de download via `chrome.downloads` + refetch da URL resolvida** — desenho razoável, mas nunca testado contra um "Processada com resultado" de verdade (não existia nenhum disponível durante o desenvolvimento).

## Fora de escopo desta v1

- Tela no Portal para gerar/gerenciar o token da extensão (por enquanto, gerar via `curl` numa sessão de staff autenticada).
- Detecção/tratamento de CAPTCHA (o formulário de extração carrega `recaptcha/api.js` — se aparecer um desafio visível, a extensão hoje não teria como resolver e provavelmente vai travar numa espera; precisa de um handler explícito depois de observar como ele realmente aparece).
