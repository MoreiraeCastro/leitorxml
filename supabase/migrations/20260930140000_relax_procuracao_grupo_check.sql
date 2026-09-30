begin;

-- Grupo/posição da procuração agora são descobertos automaticamente pela
-- extensão (varredura completa) ou pelo índice, não exigidos no cadastro
-- manual — essa constraint ficou incompatível com isso.
alter table public.xml_watch_establishments drop constraint if exists xml_watch_establishments_check;

commit;
