import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { EmptyState, PageHeader, Shell } from "@/components/shell";
import { previousClosedCompetencia } from "@/lib/leitorxml/tasks";
import { dispararExtracao } from "../actions";

export const metadata = { title: "Nova extração" };

export default async function NovaExtracaoPage() {
  const session = await requireOfficeSessionOrRedirect();
  const { data: establishments, error } = await createAdminClient()
    .from("xml_watch_establishments")
    .select("id,cnpj,razao_social,situacao_cadastral,ativo")
    .order("razao_social");
  const fallback = previousClosedCompetencia();

  return (
    <Shell session={session}>
      <PageHeader
        back={{ href: "/painel", label: "Início" }}
        title="Nova extração"
        subtitle="Escolha as empresas e o mês. Cada uma ganha as 3 tarefas. Inativas e baixadas são ignoradas."
      />

      {error && <p role="alert" className="callout callout-danger">Não foi possível carregar os estabelecimentos.</p>}

      {!error && (
        <form action={dispararExtracao} className="flex flex-col gap-6">
          <div className="flex items-end gap-4">
            <div className="field">
              <label htmlFor="competenciaAno" className="label">Ano</label>
              <input id="competenciaAno" name="competenciaAno" type="number" required defaultValue={fallback.competenciaAno} className="input tabular w-24" />
            </div>
            <div className="field">
              <label htmlFor="competenciaMes" className="label">Mês</label>
              <input id="competenciaMes" name="competenciaMes" type="number" min={1} max={12} required defaultValue={fallback.competenciaMes} className="input tabular w-20" />
            </div>
          </div>

          <div className="table-wrap">
            <div className="border-b border-[var(--line)] bg-[var(--table-head)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-[var(--muted)]">Estabelecimentos</div>
            <div className="max-h-96 divide-y divide-[var(--line)] overflow-y-auto">
              {(establishments ?? []).map((establishment) => {
                const excluded = !establishment.ativo || establishment.situacao_cadastral === "Baixada";
                return (
                  <label key={establishment.id} className={`check px-4 py-2.5 transition-colors ${excluded ? "text-[var(--muted)] opacity-70" : "cursor-pointer hover:bg-[var(--table-head)]"}`}>
                    <input type="checkbox" name="establishmentIds" value={establishment.id} disabled={excluded} defaultChecked={!excluded} />
                    <span className="flex-1">{establishment.razao_social} <span className="tabular text-[var(--text-2)]">— {establishment.cnpj}</span></span>
                    {excluded && <span className="pill">{establishment.situacao_cadastral === "Baixada" ? "Baixada" : "Inativo"}</span>}
                  </label>
                );
              })}
              {!establishments?.length && (
                <EmptyState
                  title="Nenhum estabelecimento cadastrado"
                  text="Cadastre uma empresa primeiro para poder criar as tarefas."
                  action={<Link href="/estabelecimentos/novo" className="btn btn-secondary">Nova empresa</Link>}
                />
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" className="btn">Criar tarefas</button>
          </div>
        </form>
      )}
    </Shell>
  );
}
