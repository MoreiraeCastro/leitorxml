begin;

-- Leitor de XML: coleta em lote de NF-e/NFC-e do Fisco Facil (SEFAZ-RJ) via
-- extensao Chrome + este backend. Carteira propria do escritorio (colaborador
-- opera com certificado proprio ou por procuracao do escritorio), sem relacao
-- com organizations/RLS multi-tenant do modulo de emissao -- por isso usa o
-- padrao staff-only ja existente (private.is_office_user()), nao is_member.
-- Ver _handoff/leitorxml_descoberta_handoff.md e leitorxml_design_tecnico.md.

create type public.xml_watch_certificate_type as enum ('ESCRITORIO_PROCURACAO', 'PROPRIO');
create type public.xml_collection_document_type as enum ('NFE', 'NFCE');
create type public.xml_collection_role as enum ('EMITENTE', 'DESTINATARIO');
create type public.xml_collection_status as enum (
  'AGENDADA', 'NA_FILA', 'AUTENTICANDO', 'SELECIONANDO_CONTEXTO', 'SOLICITADO',
  'PROCESSANDO_SEFAZ', 'SEM_DOCUMENTOS', 'PRONTO_PARA_BAIXAR', 'BAIXANDO', 'VALIDANDO',
  'SALVANDO_SHAREPOINT', 'DISPONIVEL_REVISAO', 'REVISADO', 'EXPIRADA', 'FALHA', 'AGUARDANDO_INTERVENCAO'
);
create type public.xml_collection_file_validation as enum ('OK', 'QUARENTENA', 'REJEITADO');

create table public.xml_watch_establishments (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null unique check (cnpj ~ '^[0-9]{14}$'),
  inscricao_estadual text,
  razao_social text not null,
  codigo_dominio text,
  responsavel text,
  sharepoint_folder_path text,
  situacao_cadastral text,
  certificado_tipo public.xml_watch_certificate_type not null,
  procuracao_grupo text,
  procuracao_posicao int,
  ativo boolean not null default true,
  locked_by_user_id uuid references public.profiles(user_id) on delete set null,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (certificado_tipo <> 'ESCRITORIO_PROCURACAO' or procuracao_grupo is not null)
);
create index xml_watch_establishments_active_idx on public.xml_watch_establishments(ativo) where ativo;

create table public.xml_watch_procuration_index (
  id uuid primary key default gen_random_uuid(),
  procuracao_grupo text not null,
  posicao int not null check (posicao > 0),
  cnpj text,
  situacao_cadastral text,
  last_verified_at timestamptz not null default now(),
  unique (procuracao_grupo, posicao)
);

-- Uma linha por combinacao estabelecimento x competencia x tipo x papel --
-- exatamente as 3 combinacoes mapeadas na Descoberta (NF-e/Emitente,
-- NF-e/Destinatario, NFC-e/Emitente). A UNIQUE e a chave de idempotencia:
-- nunca cria pedido duplicado para a mesma combinacao/competencia.
create table public.xml_collection_tasks (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.xml_watch_establishments(id) on delete cascade,
  competencia_ano int not null check (competencia_ano between 2020 and 2100),
  competencia_mes int not null check (competencia_mes between 1 and 12),
  tipo_documento public.xml_collection_document_type not null,
  papel public.xml_collection_role not null,
  status public.xml_collection_status not null default 'AGENDADA',
  sefaz_referencia text,
  sefaz_previsao_conclusao timestamptz,
  tentativas int not null default 0,
  ultima_verificacao_at timestamptz,
  proxima_verificacao_at timestamptz,
  prazo_alerta_at timestamptz,
  erro_mensagem text,
  storage_path_zip text,
  sharepoint_item_id text,
  sharepoint_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (establishment_id, competencia_ano, competencia_mes, tipo_documento, papel),
  check (tipo_documento <> 'NFCE' or papel = 'EMITENTE')
);
create index xml_collection_tasks_status_idx on public.xml_collection_tasks(status, proxima_verificacao_at);
create index xml_collection_tasks_establishment_idx on public.xml_collection_tasks(establishment_id, competencia_ano desc, competencia_mes desc);

create table public.xml_collection_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.xml_collection_tasks(id) on delete cascade,
  hash_sha256 text not null,
  tamanho_bytes bigint not null check (tamanho_bytes > 0),
  quantidade_documentos int,
  resultado_validacao public.xml_collection_file_validation not null,
  detalhes_validacao jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index xml_collection_files_task_idx on public.xml_collection_files(task_id);

-- A extensao Chrome nao autentica por sessao Supabase: cada colaborador gera
-- um token (rota /api/leitorxml/extensao/tokens) colado uma vez na extensao.
-- Guardamos so o hash -- o valor em texto puro so existe na resposta da criacao.
create table public.xml_leitor_extension_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index xml_leitor_extension_tokens_user_idx on public.xml_leitor_extension_tokens(user_id) where revoked_at is null;

alter table public.xml_watch_establishments enable row level security;
alter table public.xml_watch_procuration_index enable row level security;
alter table public.xml_collection_tasks enable row level security;
alter table public.xml_collection_files enable row level security;
alter table public.xml_leitor_extension_tokens enable row level security;

grant select, insert, update, delete on public.xml_watch_establishments to authenticated;
grant select, insert, update on public.xml_watch_procuration_index to authenticated;
grant select, insert, update on public.xml_collection_tasks to authenticated;
grant select, insert on public.xml_collection_files to authenticated;
grant select, insert, update on public.xml_leitor_extension_tokens to authenticated;

-- Rotas extensao/* usam createAdminClient() (bypassa RLS) apos validar o
-- token manualmente; estas policies protegem o acesso futuro do Portal
-- (sessao normal de staff), nao o fluxo da extensao.
create policy xml_watch_establishments_office_select on public.xml_watch_establishments for select to authenticated using (private.is_office_user());
create policy xml_watch_establishments_office_insert on public.xml_watch_establishments for insert to authenticated with check (private.is_office_user());
create policy xml_watch_establishments_office_update on public.xml_watch_establishments for update to authenticated using (private.is_office_user()) with check (private.is_office_user());
create policy xml_watch_establishments_office_delete on public.xml_watch_establishments for delete to authenticated using (private.is_office_user());

create policy xml_watch_procuration_index_office_select on public.xml_watch_procuration_index for select to authenticated using (private.is_office_user());
create policy xml_watch_procuration_index_office_insert on public.xml_watch_procuration_index for insert to authenticated with check (private.is_office_user());
create policy xml_watch_procuration_index_office_update on public.xml_watch_procuration_index for update to authenticated using (private.is_office_user()) with check (private.is_office_user());

create policy xml_collection_tasks_office_select on public.xml_collection_tasks for select to authenticated using (private.is_office_user());
create policy xml_collection_tasks_office_insert on public.xml_collection_tasks for insert to authenticated with check (private.is_office_user());
create policy xml_collection_tasks_office_update on public.xml_collection_tasks for update to authenticated using (private.is_office_user()) with check (private.is_office_user());

create policy xml_collection_files_office_select on public.xml_collection_files for select to authenticated using (private.is_office_user());
create policy xml_collection_files_office_insert on public.xml_collection_files for insert to authenticated with check (private.is_office_user());

-- Cada colaborador so ve/gerencia os proprios tokens -- nao e staff-wide.
create policy xml_leitor_extension_tokens_self_select on public.xml_leitor_extension_tokens for select to authenticated using (user_id = (select auth.uid()));
create policy xml_leitor_extension_tokens_self_insert on public.xml_leitor_extension_tokens for insert to authenticated with check (user_id = (select auth.uid()));
create policy xml_leitor_extension_tokens_self_update on public.xml_leitor_extension_tokens for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values
('leitorxml-staging', 'leitorxml-staging', false, 52428800, array['application/zip', 'application/x-zip-compressed'])
on conflict (id) do nothing;
-- Sem policy de leitura para usuarios: staging só é acessado pelo backend
-- (service key) ate a gravacao no SharePoint, que ainda nao existe.

commit;
