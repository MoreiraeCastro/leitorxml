-- "Baixado ✓": o ZIP já foi salvo na pasta de algum PC do escritório. É o fim do processo para o pedido
-- (substitui a etapa "Revisar" nos pedidos novos) e dá controle de quais empresas já avançaram.
-- Pedido do João em 13/10/2026: os dois PCs continuam baixando, mas o primeiro que salvar marca o check.
alter type public.xml_collection_status add value if not exists 'BAIXADO' after 'DISPONIVEL_REVISAO';

alter table public.xml_collection_tasks
  add column if not exists baixado_at timestamptz,
  add column if not exists baixado_por_nome text;
