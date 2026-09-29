# Leitor de XML

Coleta em lote de NF-e/NFC-e do Fisco Fácil (SEFAZ-RJ) para o escritório Moreira & Castro. Repositório separado do `fiscalmc-latest` (Portal Moreira), mas usa o **mesmo projeto Supabase** — mesmo banco, mesmos usuários/papéis (`OFFICE_STAFF`/`SUPER_ADMIN`).

Ver `_handoff/leitorxml_descoberta_handoff.md` (roteiro de extração mapeado ao vivo no Fisco Fácil) e `_handoff/leitorxml_design_tecnico.md` (schema e contrato do conector) para o contexto completo.

## Estrutura

- `src/lib/leitorxml/*` — regras de negócio (tarefas, índice de procurações, tokens de extensão, validação de ZIP, sweep).
- `src/app/api/leitorxml/*` e `src/app/api/internal/leitorxml-sweep` — rotas de API (contrato extensão ↔ backend, mais a varredura periódica).
- `src/app/login`, `src/app/page.tsx` — login e shell do Portal (staff-only), ainda mínimo.
- `extension/` — extensão Chrome que vai operar o Fisco Fácil (ainda não iniciada).
- `supabase/migrations/` — schema, aplicado ao mesmo projeto Supabase do `fiscalmc-latest`.
- `deploy/leitorxml-sweep.{service,timer}` — cron do sweep (systemd), mesmo padrão do `reconcile-pending` do fiscalmc.

## Setup

```bash
npm install
cp .env.example .env.local   # preencher com as credenciais do mesmo projeto Supabase do fiscalmc-latest
npm run dev
```

## Verificação

```bash
npm run typecheck
npm run lint
npm run test
```
