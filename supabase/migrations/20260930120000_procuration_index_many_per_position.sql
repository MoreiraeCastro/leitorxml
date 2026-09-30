begin;

-- Uma posição de procuração leva a uma lista PAGINADA de empresas (confirmado
-- ao vivo em 2026-09-30 — uma posição sob "SUBFIN" mostrou 5+ empresas em
-- 2 páginas), não uma única empresa. A UNIQUE original (grupo, posicao)
-- só permitia guardar uma linha por posição — corrigindo para (grupo,
-- posicao, cnpj), permitindo várias empresas descobertas na mesma posição.

alter table public.xml_watch_procuration_index
  drop constraint if exists xml_watch_procuration_index_procuracao_grupo_posicao_key;

update public.xml_watch_procuration_index set cnpj = '' where cnpj is null;
update public.xml_watch_procuration_index set situacao_cadastral = 'Desconhecida' where situacao_cadastral is null;
delete from public.xml_watch_procuration_index where cnpj = '';

alter table public.xml_watch_procuration_index
  alter column cnpj set not null,
  alter column situacao_cadastral set not null;

alter table public.xml_watch_procuration_index
  add constraint xml_watch_procuration_index_grupo_posicao_cnpj_key unique (procuracao_grupo, posicao, cnpj);

create index xml_watch_procuration_index_cnpj_idx on public.xml_watch_procuration_index(cnpj);

commit;
