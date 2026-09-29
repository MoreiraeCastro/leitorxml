# Extensão Chrome — Leitor de XML (Fisco Fácil)

Manifest V3. Opera o Fisco Fácil (SEFAZ-RJ) no navegador do colaborador, autenticado pelo certificado A1 local, consumindo as rotas `/api/leitorxml/extensao/*` do backend deste mesmo repositório.

## Carregar para teste

1. `chrome://extensions` → ativar "Modo do desenvolvedor" → "Carregar sem compactação" → selecionar esta pasta (`extension/`).
2. Clicar no ícone da extensão → preencher URL do backend (`http://localhost:3003/leitorxml` em dev) e o token (gerado em `POST /api/leitorxml/extensao/tokens`, autenticado com sessão do Portal — por enquanto só via `curl`/Postman, a tela de gerar token ainda não existe no Portal).
3. Com o Fisco Fácil acessível (certificado A1 carregado no Windows), clicar "Buscar próxima tarefa".

## Arquitetura

- `src/background.js` — service worker. Único lugar que fala com o backend (token, fetch). Mantém o estado da execução em `chrome.storage.session` (`activeRun`) e escuta `chrome.downloads` para capturar o ZIP quando uma solicitação está pronta.
- `src/content-home.js` — roda em `ssacert.fazenda.rj.gov.br`. Abre "AUTO Fisco Fácil", navega até a procuração certa.
- `src/content-fisco.js` — roda em `fisco-facil.fazenda.rj.gov.br`. Detecta a página atual pelo `location.pathname` e executa a ação certa: lista de empresas, painel da empresa, formulário de extração, leitura da aba Solicitações.
- `src/dom-utils.js` — helpers compartilhados (espera de AJAX via `#loading`, clique/matching por texto).
- `popup/` — configuração de URL/token e disparo manual de "próxima tarefa".

## O que está confirmado (HTML real + gravação de tela, 2026-09-29)

- URLs reais: `ssacert.fazenda.rj.gov.br/ssa/certificadoWeb` → `fisco-facil.fazenda.rj.gov.br/SATI-FiscoFacil/privado/{principalContribuintes,mainAbasContribuinte,solicitacoes/solicitacaoExtracaoDfe}.xhtml`.
- Todos os IDs de campo do formulário de extração, da tabela de empresas (`FrmFisco:ListaContribuintes`, com busca por CNPJ) e da aba Solicitações (`frmHistInteracoes:tabsHist:solicitacao`).
- O clique na "Situação" de uma solicitação processada dispara o download do ZIP diretamente (não é um modal com botão dentro) — confirmado pelo usuário.

## O que ainda é suposição — validar na PoC (Fase 2)

1. **Formato da data no formulário de extração.** O campo mostra "08/2026" na tela depois de escolher "Meses", mas não sabemos se é isso que o servidor espera receber, ou se só a exibição é resumida. Implementado setando esse valor direto via JS (sem navegar o calendário por clique) — se o servidor rejeitar, ajustar `formatCompetencia()` em `content-fisco.js`.
2. **HTML exato do modal "Escolha um perfil".** Só vimos print, nunca o DOM. `collectProcuracaoLinks()` em `content-home.js` usa uma heurística (agrupa por texto curto anterior a cada "Acesso por procuração") — pode precisar ajuste.
3. **Índice de procurações não é descoberto automaticamente.** Se `procuracao_posicao` não estiver preenchido no cadastro do estabelecimento, a extensão para e pede intervenção em vez de escanear procurações. Preencher manualmente em Estabelecimentos por enquanto.
4. **Certificado próprio (não por procuração) não está automatizado.** Trocar de certificado A1 ativo no navegador exige o seletor nativo do Windows/Chrome, que a extensão não consegue acionar sozinha — hoje ela só reporta "aguardando intervenção" pra esses casos.
5. **Captura de download via `chrome.downloads` + refetch da URL resolvida** — desenho razoável, mas nunca testado contra um "Processada com resultado" de verdade (não existia nenhum disponível durante o desenvolvimento).

## Fora de escopo desta v1

- Tela no Portal para gerar/gerenciar o token da extensão (por enquanto, gerar via `curl` numa sessão de staff autenticada).
- Detecção/tratamento de CAPTCHA (o formulário de extração carrega `recaptcha/api.js` — se aparecer um desafio visível, a extensão hoje não teria como resolver e provavelmente vai travar numa espera; precisa de um handler explícito depois de observar como ele realmente aparece).
