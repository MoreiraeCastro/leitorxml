begin;

-- Conexao unica (singleton) do escritorio com o SharePoint, via login delegado
-- (device code): guardamos so o refresh token, cifrado pela aplicacao
-- (AES-256-GCM, chave SHAREPOINT_TOKEN_KEY) -- nunca em texto puro.
create table public.xml_sharepoint_connection (
  id int primary key default 1 check (id = 1),
  account text,
  refresh_token_enc text,
  -- login em andamento: device_code cifrado + quando expira (ate ~15 min)
  device_code_enc text,
  device_expires_at timestamptz,
  root_drive_id text,
  root_item_id text,
  root_web_url text,
  root_name text,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Somente o servidor (service role) le/escreve: sem grants nem policies para
-- authenticated, o refresh token nunca chega a uma sessao de usuario.
alter table public.xml_sharepoint_connection enable row level security;

commit;
