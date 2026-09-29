# Leitor de XML (Fisco Fácil) — Design Técnico (schema + contrato do conector)

Data: 2026-09-28
Depende de: `leitorxml_descoberta_handoff.md` (roteiro de extração mapeado, decisões de arquitetura).

## Status de implementação (2026-09-28)

O backend descrito neste documento **já foi implementado**: migration em `supabase/migrations/20260928200000_leitorxml_schema.sql`, lib em `src/lib/leitorxml/*` (inclui `zip.ts`, um leitor de ZIP próprio, sem dependência nova — o projeto não tinha biblioteca de ZIP), rotas em `src/app/api/leitorxml/*` e `src/app/api/internal/leitorxml-sweep`, testes em `tests/unit/leitorxml-*.test.ts` (todos passando), e os arquivos de deploy do cron em `deploy/leitorxml-sweep.{service,timer}` (mesmo padrão do `reconcile-pending`, rodando a cada 3 dias). Falta configurar `INTERNAL_LEITORXML_SECRET` no ambiente antes de ativar o timer em produção.

**Fora desta rodada** (conforme decidido): páginas do Portal em `src/app/app/leitorxml/*`, a extensão Chrome, e a gravação real no SharePoint via Microsoft Graph (aguardando o app registration no Azure AD — Fase 0). O sweep já escalona tarefas paradas e gera o lote mensal, mas os arquivos ficam em `DISPONIVEL_REVISAO`/staging até a integração com o SharePoint existir.

## 1. Modelagem: roster próprio, não reaproveita `organizations`

Confirmado: as empresas do Leitor de XML são uma **carteira separada** do escritório (acesso via colaborador interno, certificado próprio ou procuração), **sem sobreposição** com as empresas que usam o módulo de emissão (`organizations`, multi-tenant com RLS). Por isso este módulo ganha tabelas próprias, com controle de acesso por papel do colaborador (operador fiscal / revisor / administrador técnico), não por `organization_id`.

## 2. Tabelas (Supabase/Postgres)

### `xml_watch_establishments` — cadastro das empresas monitoradas

| Campo | Tipo | Observação |
|---|---|---|
| id | uuid pk | |
| cnpj | text unique | 14 dígitos |
| inscricao_estadual | text | |
| razao_social | text | |
| codigo_dominio | text | código no sistema Domínio |
| responsavel | text | colaborador responsável |
| sharepoint_folder_path | text | referência da pasta final |
| situacao_cadastral | text | última situação conhecida (Habilitada/Baixada/...), sincronizada oportunisticamente |
| certificado_tipo | enum(`ESCRITORIO_PROCURACAO`, `PROPRIO`) | qual certificado usar |
| procuracao_grupo | text nullable | ex.: "SUBFIN" — só quando `ESCRITORIO_PROCURACAO` |
| procuracao_posicao | int nullable | posição cacheada na lista do grupo (ver índice abaixo) |
| ativo | boolean default true | permite tirar uma empresa da rotina sem apagar cadastro |
| created_at / updated_at | timestamptz | |

Regra de negócio: empresas com `situacao_cadastral = 'Baixada'` são automaticamente excluídas da geração mensal de tarefas (ver §4), mesmo que `ativo = true`.

### `xml_watch_procuration_index` — índice de procurações (cache)

| Campo | Tipo | Observação |
|---|---|---|
| id | uuid pk | |
| procuracao_grupo | text | |
| posicao | int | posição 1-based na lista daquele grupo |
| cnpj | text nullable | CNPJ encontrado nessa posição na última indexação |
| situacao_cadastral | text nullable | |
| last_verified_at | timestamptz | |

`UNIQUE(procuracao_grupo, posicao)`. Populado/atualizado pela extensão via `POST /procuracao-indice` (§5) durante varreduras. Consumido para resolver `procuracao_posicao` no cadastro sem precisar reabrir procuração por procuração às cegas — só recai em reindexação se o CNPJ esperado não bater mais naquela posição.

### `xml_collection_tasks` — unidade de trabalho

Uma linha por combinação (estabelecimento × competência × tipo de documento × papel), refletindo exatamente as 3 combinações mapeadas na Descoberta (NF-e/Emitente, NF-e/Destinatário, NFC-e/Emitente).

| Campo | Tipo | Observação |
|---|---|---|
| id | uuid pk | |
| establishment_id | fk → xml_watch_establishments | |
| competencia_ano, competencia_mes | int | mês fechado sendo coletado |
| tipo_documento | enum(`NFE`, `NFCE`) | |
| papel | enum(`EMITENTE`, `DESTINATARIO`) | NFC-e só usa `EMITENTE` |
| status | enum | ver lista abaixo |
| sefaz_referencia | text nullable | a "Referência" do pedido no Fisco Fácil — chave para reencontrar/retomar |
| sefaz_previsao_conclusao | timestamptz nullable | guardado só para histórico; **não confiável operacionalmente** (visto previsão de semanas quando na prática resolve em horas) |
| tentativas | int default 0 | |
| ultima_verificacao_at / proxima_verificacao_at | timestamptz | usado pelo sweep (§6) |
| prazo_alerta_at | timestamptz | quando completar 24h sem avanço, dispara aviso de checagem manual |
| erro_mensagem | text nullable | |
| storage_path_zip | text nullable | staging (Supabase Storage) antes de ir pro SharePoint |
| sharepoint_item_id, sharepoint_path | text nullable | |
| created_at / updated_at | timestamptz | |

`UNIQUE(establishment_id, competencia_ano, competencia_mes, tipo_documento, papel)` — é a chave de idempotência: nunca cria pedido duplicado para a mesma combinação/competência.

**Status** (mapeando os estados do documento original + o que a Descoberta confirmou):
`AGENDADA` → `NA_FILA` → `AUTENTICANDO` → `SELECIONANDO_CONTEXTO` → `SOLICITADO` → `PROCESSANDO_SEFAZ` → (`SEM_DOCUMENTOS` | `PRONTO_PARA_BAIXAR` → `BAIXANDO` → `VALIDANDO` → `SALVANDO_SHAREPOINT` → `DISPONIVEL_REVISAO` → `REVISADO`) | `EXPIRADA` | `FALHA` | `AGUARDANDO_INTERVENCAO`.

### `xml_collection_files` — arquivos recebidos por tarefa

| Campo | Tipo | Observação |
|---|---|---|
| id | uuid pk | |
| task_id | fk → xml_collection_tasks | |
| hash_sha256 | text | dedup e detecção de reprocessamento |
| tamanho_bytes | bigint | |
| quantidade_documentos | int nullable | quantos XMLs vieram dentro do ZIP |
| resultado_validacao | enum(`OK`, `QUARENTENA`, `REJEITADO`) | |
| detalhes_validacao | jsonb | motivo de quarentena/rejeição quando houver |
| created_at | timestamptz | |

### Auditoria e trava de concorrência

- **Auditoria**: reaproveitar a tabela `audit_logs` já usada pelo fluxo de reconciliação de notas (`src/app/api/invoices/[id]/reconcile/route.ts`) — não criar tabela nova só para isso.
- **Trava de concorrência**: como só é possível operar **uma empresa por vez** dentro de uma sessão de navegador (§3.5 do handoff de Descoberta), a trava é por **estabelecimento**, não por tarefa. Adicionar `locked_by_user_id` e `locked_at` em `xml_watch_establishments`, com TTL curto (ex.: expira sozinha depois de N minutos de inatividade, para não travar permanentemente se a extensão cair no meio de uma execução).

## 3. Contrato do conector (extensão ↔ portal)

Rotas novas em `src/app/api/leitorxml/extensao/*`, autenticadas por **token de API** (não cookie de sessão): gerado numa tela do Portal (ex.: em "Perfil" ou uma tela própria "Extensão"), vinculado a um colaborador + papel, colado uma vez na extensão. Evita depender de cookies cross-origin/SameSite entre o domínio do Portal e o contexto da extensão — decisão de design, revisitável na PoC se aparecer algo melhor.

| Operação | Rota | Função |
|---|---|---|
| Autenticar extensão | `POST /extensao/auth` | Valida token, retorna colaborador/papel |
| Pegar próxima tarefa | `GET /extensao/proxima-tarefa` | Retorna a próxima combinação elegível, já resolvendo se é procuração (grupo+posição do índice) ou certificado próprio, respeitando a trava de estabelecimento |
| Reportar índice de procuração | `POST /extensao/procuracao-indice` | Upsert em `xml_watch_procuration_index` durante uma varredura |
| Reportar evento/transição | `POST /extensao/tarefas/{id}/eventos` | Atualiza status + `sefaz_referencia`, `sefaz_previsao_conclusao`, timestamps |
| Upload do ZIP | `POST /extensao/tarefas/{id}/upload` | Multipart; backend valida (formato, descompactação segura, hash, chave de acesso, CNPJ, modelo, data emissão), grava em staging |
| Reportar falha/intervenção | `POST /extensao/tarefas/{id}/falha` | Marca `AGUARDANDO_INTERVENCAO` com motivo |

Rotas do portal (sessão normal do staff, sem token de extensão):
- `src/app/app/leitorxml/*` — páginas: painel mensal, cadastro, nova extração, detalhe do pedido, conferência e arquivos (conforme §4 do documento de escopo original).
- `POST /api/leitorxml/tarefas` — cria as tarefas em lote a partir da seleção feita em "Nova extração" (competência + estabelecimentos + modelos), respeitando o filtro de `situacao_cadastral != 'Baixada'` e a chave de idempotência.
- `POST /api/internal/leitorxml-sweep` — varredura periódica (mesmo padrão do `reconcile-pending`): reconsulta tarefas em `PROCESSANDO_SEFAZ`, aplica a regra de 24h → `AGUARDANDO_INTERVENCAO`, dispara o lote mensal no dia 10, e move arquivos validados de staging para o SharePoint via Graph.

## 4. Geração de tarefas (disparo mensal)

No dia 10, para cada `xml_watch_establishment` com `ativo = true` e `situacao_cadastral != 'Baixada'`: criar (se não existir, pela chave única) as 3 tarefas do mês anterior fechado — NF-e/Emitente, NF-e/Destinatário, NFC-e/Emitente — com status `AGENDADA`.

## 5. Sweep de acompanhamento

`POST /api/internal/leitorxml-sweep`, chamado a cada 3 dias (cron externo, mesmo mecanismo do `reconcile-pending`):
- Tarefas em `PROCESSANDO_SEFAZ` há mais de 24h sem atualização → `AGUARDANDO_INTERVENCAO` (revisão manual).
- Tarefas prontas para download não baixadas ainda → seguem na fila da extensão.
- Arquivos validados em staging → tentativa de gravação no SharePoint; falha de gravação **não** marca a tarefa como concluída (regra explícita do documento original).

## 6. Em aberto

- Confirmar na PoC (Fase 2) se o token de API é suficiente/prático para a extensão, ou se aparece um jeito melhor de autenticar (ex.: reaproveitar sessão do Portal se a extensão e o Portal rodarem no mesmo perfil de Chrome).
- Definir o TTL exato da trava de estabelecimento (`locked_at`) com base no tempo real observado por empresa durante o piloto.
