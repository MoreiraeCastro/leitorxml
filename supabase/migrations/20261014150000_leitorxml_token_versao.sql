-- Versão da extensão de cada PC, gravada a cada consulta (cabeçalho X-Leitor-Versao, enviado desde a 0.1.5):
-- dá pra ver se um PC ficou numa versão antiga sem pedir print da tela (14/10/2026).
alter table public.xml_leitor_extension_tokens
  add column if not exists ultima_versao text,
  add column if not exists ultima_versao_at timestamptz;
