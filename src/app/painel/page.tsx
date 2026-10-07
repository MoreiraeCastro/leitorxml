import Link from "next/link";
import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell } from "@/components/shell";
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
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-900",
  neutral: "border-black/10 bg-white text-black/80",
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
  if (!task) return <span className="text-black/25">—</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      <Link href={`/pedidos/${task.id}`} title={task.erro ?? undefined} className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#082240]/40">
        <Pill phase={task.phase}>{pillLabel(task.status)}</Pill>
      </Link>
      {canRequestAgain(task.status) && (
        <form action={pedirDeNovo.bind(null, task.id)}>
          <button type="submit" className="text-xs font-medium text-[#082240] underline-offset-2 hover:underline">Pedir de novo</button>
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
  const chipCount: Record<FilterKey, number> = { TUDO: counts.empresas, PEDIR: counts.PEDIR, SEFAZ: counts.SEFAZ, PRONTA: counts.PRONTA, REVISAR: counts.REVISAR, PROBLEMA: counts.PROBLEMA };

  return (
    <Shell session={session}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link href={href(previous.ano, previous.mes, "TUDO", "")} aria-label="Mês anterior" className="rounded-md px-2 py-1 text-black/50 hover:bg-black/5">←</Link>
          <h1 className="min-w-[10rem] text-center text-xl font-semibold capitalize text-[#082240]">{competencia}</h1>
          <Link href={href(next.ano, next.mes, "TUDO", "")} aria-label="Próximo mês" className="rounded-md px-2 py-1 text-black/50 hover:bg-black/5">→</Link>
        </div>
        {counts.empresas > 0 && <span className="text-sm text-black/60">{counts.empresasRecebidas} de {counts.empresas} empresas recebidas</span>}
        <details className="relative ml-auto">
          <summary className="cursor-pointer list-none rounded-md border border-black/15 bg-white px-3 py-1.5 text-sm font-medium text-[#082240] hover:bg-black/[0.03]">+ Criar tarefas do mês</summary>
          <form action={criarTarefasDoMes} className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-black/10 bg-white p-4 shadow-lg">
            <p className="text-sm text-black/70">Cria as 3 tarefas de cada empresa ativa. O que já existe não duplica.</p>
            <div className="mt-3 flex items-end gap-2">
              <label className="text-xs text-black/50">Ano<input name="competenciaAno" type="number" defaultValue={ano} className="mt-1 block w-20 rounded border border-black/15 px-2 py-1 text-sm text-black" /></label>
              <label className="text-xs text-black/50">Mês<input name="competenciaMes" type="number" min={1} max={12} defaultValue={mes} className="mt-1 block w-16 rounded border border-black/15 px-2 py-1 text-sm text-black" /></label>
              <button type="submit" className="ml-auto rounded-md bg-[#082240] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#123a5d]">Criar</button>
            </div>
            <Link href="/extracao/nova" className="mt-3 block text-xs text-black/50 underline-offset-2 hover:underline">Escolher só algumas empresas</Link>
          </form>
        </details>
      </div>

      {counts.empresas > 0 && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Empresas recebidas">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-700">Não foi possível carregar as tarefas.</p>}

      <section className={`mt-5 flex flex-wrap items-center gap-4 rounded-xl border px-5 py-4 ${CARD_TONE[action.tone]}`}>
        <div className="min-w-[14rem] flex-1">
          <div className="text-base font-semibold">{action.title}</div>
          <div className="mt-0.5 text-sm opacity-80">{action.detail}</div>
        </div>
        {action.cta && (action.cta.external
          ? <a href={action.cta.href} target="_blank" rel="noreferrer" className="rounded-md bg-[#082240] px-4 py-2 text-sm font-medium text-white hover:bg-[#123a5d]">{action.cta.label}</a>
          : <Link href={href(ano, mes, parseFilter(action.cta.href.replace("?f=", "")), "")} className="rounded-md bg-[#082240] px-4 py-2 text-sm font-medium text-white hover:bg-[#123a5d]">{action.cta.label}</Link>)}
      </section>

      {counts.empresas > 0 && (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {FILTERS.map((item) => {
              const active = item.key === filter;
              const danger = item.key === "PROBLEMA" && chipCount.PROBLEMA > 0;
              return (
                <Link
                  key={item.key}
                  href={href(ano, mes, item.key, q)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${active ? "border-[#082240] bg-[#082240] text-white" : danger ? "border-red-200 bg-white text-red-700 hover:bg-red-50" : "border-black/15 bg-white text-black/70 hover:bg-black/[0.03]"}`}
                >
                  {item.label} <b className="font-semibold">{chipCount[item.key]}</b>
                </Link>
              );
            })}
            <form action={withBasePath("/painel")} className="ml-auto">
              <input type="hidden" name="ano" value={ano} />
              <input type="hidden" name="mes" value={mes} />
              {filter !== "TUDO" && <input type="hidden" name="f" value={filter} />}
              <input name="q" defaultValue={q} placeholder="Buscar empresa ou CNPJ" className="w-56 rounded-full border border-black/15 bg-white px-3 py-1 text-sm" />
            </form>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-black/10 bg-white">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs text-black/50">
                  <th className="px-4 py-2.5 font-medium">Empresa</th>
                  {SLOTS.map((slot) => <th key={slot.key} className="px-4 py-2.5 font-medium">{slot.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.establishmentId} className="border-b border-black/5 align-top last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#082240]">{row.razaoSocial}</div>
                      <div className="text-xs text-black/40">{row.cnpj}</div>
                    </td>
                    {SLOTS.map((slot) => <td key={slot.key} className="px-4 py-3"><TaskCell task={row.tasks[slot.key]} /></td>)}
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-black/50">Nenhuma empresa nesse filtro. <Link href={href(ano, mes, "TUDO", "")} className="underline">Ver todas</Link></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}
