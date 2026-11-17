import Link from "next/link";
import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmptyState, Shell } from "@/components/shell";
import { Pill } from "@/components/pill";
import { withBasePath } from "@/lib/base-path";
import { previousClosedCompetencia } from "@/lib/leitorxml/tasks";
import { competenciaLabel, canRequestAgain } from "@/lib/leitorxml/status-labels";
import { FILTERS, SLOTS, filterRows, groupByCompany, nextAction, parseFilter, pillLabel, summarize, type CompanyTask, type FilterKey, type TaskInput } from "@/lib/leitorxml/inicio";
import { pedirDeNovo } from "../pedidos/actions";
import { criarTarefasDoMes } from "./actions";

export const metadata = { title: "Início" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  tipo_documento: string;
  papel: string;
  status: string;
  erro_mensagem: string | null;
  xml_watch_establishments: { id: string; cnpj: string; razao_social: string } | { id: string; cnpj: string; razao_social: string }[] | null;
};

const CARD_TONE = {
  ok: "callout-ok",
  info: "callout-info",
  warn: "callout-warn",
  danger: "callout-danger",
  neutral: "",
} as const;

function shiftMonth(ano: number, mes: number, delta: number) {
  const date = new Date(ano, mes - 1 + delta, 1);
  return { ano: date.getFullYear(), mes: date.getMonth() + 1 };
}

function href(ano: number, mes: number, filter: FilterKey, q: string) {
  const params = new URLSearchParams({ ano: String(ano), mes: String(mes) });
  if (filter !== "TUDO") params.set("f", filter);
  if (q) params.set("q", q);
  return `/painel?${params}`;
}

function TaskCell({ task }: { task?: CompanyTask }) {
  if (!task) return <span className="text-[#cbd5e1]">—</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      <Link href={`/pedidos/${task.id}`} title={task.erro ?? undefined} className="rounded-full">
        <Pill phase={task.phase}>{pillLabel(task.status)}</Pill>
      </Link>
      {canRequestAgain(task.status) && (
        <form action={pedirDeNovo.bind(null, task.id)}>
          <button type="submit" className="link text-[12px]">Pedir de novo</button>
        </form>
      )}
    </div>
  );
}

export default async function InicioPage({ searchParams }: { searchParams: Promise<{ ano?: string; mes?: string; f?: string; q?: string }> }) {
  const session = await requireOfficeSessionOrRedirect();
  const params = await searchParams;
  const fallback = previousClosedCompetencia();
  const ano = Number(params.ano) || fallback.competenciaAno;
  const mes = Math.min(12, Math.max(1, Number(params.mes) || fallback.competenciaMes));
  const filter = parseFilter(params.f);
  const q = (params.q ?? "").slice(0, 80);
  const competencia = competenciaLabel(ano, mes);

  const { data, error } = await createAdminClient()
    .from("xml_collection_tasks")
    .select("id,tipo_documento,papel,status,erro_mensagem,xml_watch_establishments(id,cnpj,razao_social)")
    .eq("competencia_ano", ano)
    .eq("competencia_mes", mes)
    .limit(2000);

  const inputs: TaskInput[] = ((error ? [] : (data as Row[] | null)) ?? []).flatMap((row) => {
    const establishment = Array.isArray(row.xml_watch_establishments) ? row.xml_watch_establishments[0] : row.xml_watch_establishments;
    return establishment ? [{ id: row.id, status: row.status, tipo_documento: row.tipo_documento, papel: row.papel, erro_mensagem: row.erro_mensagem, establishmentId: establishment.id, cnpj: establishment.cnpj, razaoSocial: establishment.razao_social }] : [];
  });
  const allRows = groupByCompany(inputs);
  const counts = summarize(allRows);
  const rows = filterRows(allRows, filter, q);
  const action = nextAction(counts, competencia);
  const previous = shiftMonth(ano, mes, -1);
  const next = shiftMonth(ano, mes, 1);
  const percent = counts.empresas ? Math.round((counts.empresasRecebidas / counts.empresas) * 100) : 0;
  const chipCount: Record<FilterKey, number> = { TUDO: counts.empresas, PEDIR: counts.PEDIR, SEFAZ: counts.SEFAZ, PRONTA: counts.PRONTA, REVISAR: counts.REVISAR, BAIXADO: counts.BAIXADO, PROBLEMA: counts.PROBLEMA };

  return (
    <Shell session={session}>
      <div className="page-head">
        <div>
          <div className="flex items-center gap-1">
            <Link href={href(previous.ano, previous.mes, "TUDO", "")} aria-label="Mês anterior" className="btn btn-icon btn-quiet">←</Link>
            <h1 className="page-title min-w-[10rem] text-center capitalize">{competencia}</h1>
            <Link href={href(next.ano, next.mes, "TUDO", "")} aria-label="Próximo mês" className="btn btn-icon btn-quiet">→</Link>
          </div>
          <p className="page-sub tabular">{counts.empresas > 0 ? `${counts.empresasRecebidas} de ${counts.empresas} empresas recebidas` : "Coleta de NF-e e NFC-e do mês, empresa por empresa."}</p>
        </div>
        <details className="relative">
          <summary className="btn btn-secondary list-none [&::-webkit-details-marker]:hidden">+ Criar tarefas do mês</summary>
          <form action={criarTarefasDoMes} className="popover absolute right-0 z-10 mt-2 w-80 p-4">
            <p className="text-[13px] text-[var(--text-2)]">Cria as 3 tarefas de cada empresa ativa. O que já existe não duplica.</p>
            <div className="mt-3 flex items-end gap-2">
              <label className="label">Ano<input name="competenciaAno" type="number" defaultValue={ano} className="input input-sm tabular mt-1.5 block w-20" /></label>
              <label className="label">Mês<input name="competenciaMes" type="number" min={1} max={12} defaultValue={mes} className="input input-sm tabular mt-1.5 block w-16" /></label>
              <button type="submit" className="btn btn-sm ml-auto h-[34px]">Criar</button>
            </div>
            <Link href="/extracao/nova" className="link mt-3 block text-[12px]">Escolher só algumas empresas</Link>
          </form>
        </details>
      </div>

      {counts.empresas > 0 && (
        <div className="meter -mt-3" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Empresas recebidas">
          <span style={{ width: `${percent}%` }} />
        </div>
      )}

      {error && <p role="alert" className="callout callout-danger mt-4">Não foi possível carregar as tarefas.</p>}

      <section className={`callout mt-5 flex flex-wrap items-center gap-4 px-5 py-4 ${CARD_TONE[action.tone]}`}>
        <div className="min-w-[14rem] flex-1">
          <div className="text-[14px] font-semibold">{action.title}</div>
          <div className="mt-0.5 text-[13px] opacity-85">{action.detail}</div>
        </div>
        {action.cta && (action.cta.external
          ? <a href={action.cta.href} target="_blank" rel="noreferrer" className="btn">{action.cta.label}</a>
          : <Link href={href(ano, mes, parseFilter(action.cta.href.replace("?f=", "")), "")} className="btn">{action.cta.label}</Link>)}
      </section>

      {counts.empresas > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {FILTERS.map((item) => {
              const active = item.key === filter;
              const danger = item.key === "PROBLEMA" && chipCount.PROBLEMA > 0;
              return (
                <Link
                  key={item.key}
                  href={href(ano, mes, item.key, q)}
                  aria-current={active ? "true" : undefined}
                  className={`chip ${danger && !active ? "chip-danger" : ""}`}
                >
                  {item.label} <b className="chip-count">{chipCount[item.key]}</b>
                </Link>
              );
            })}
            <form action={withBasePath("/painel")} className="search ml-auto">
              <input type="hidden" name="ano" value={ano} />
              <input type="hidden" name="mes" value={mes} />
              {filter !== "TUDO" && <input type="hidden" name="f" value={filter} />}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input name="q" defaultValue={q} placeholder="Buscar empresa ou CNPJ" aria-label="Buscar empresa ou CNPJ" className="input input-sm w-60" />
            </form>
          </div>

          <div className="table-wrap mt-3">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Empresa</th>
                  {SLOTS.map((slot) => <th key={slot.key}>{slot.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.establishmentId} className="align-top">
                    <td>
                      <div className="cell-title">{row.razaoSocial}</div>
                      <div className="cell-sub">{row.cnpj}</div>
                    </td>
                    {SLOTS.map((slot) => <td key={slot.key}><TaskCell task={row.tasks[slot.key]} /></td>)}
                  </tr>
                ))}
                {!rows.length && (
                  <tr className="no-hover"><td colSpan={4}>
                    <EmptyState
                      icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>}
                      title="Nenhuma empresa nesse filtro"
                      text="Troque o filtro ou limpe a busca para ver as outras empresas."
                      action={<Link href={href(ano, mes, "TUDO", "")} className="btn btn-secondary">Ver todas</Link>}
                    />
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}
