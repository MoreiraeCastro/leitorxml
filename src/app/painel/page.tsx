import Link from "next/link";
import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell } from "@/components/shell";
import { TodaySummary, loadTodayCounts } from "@/components/today-summary";
import { withBasePath } from "@/lib/base-path";
import { previousClosedCompetencia } from "@/lib/leitorxml/tasks";
import { STATUS_LABELS, competenciaLabel, documentLabel, roleLabel, statusTone } from "@/lib/leitorxml/status-labels";
import type { XmlCollectionStatus } from "@/lib/leitorxml/types";

export const metadata = { title: "Painel mensal" };

const TONE_CLASS: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  info: "bg-sky-50 text-sky-700",
  danger: "bg-red-50 text-red-700",
  neutral: "bg-black/5 text-black/60",
};

type TaskRow = {
  id: string;
  competencia_ano: number;
  competencia_mes: number;
  tipo_documento: "NFE" | "NFCE";
  papel: "EMITENTE" | "DESTINATARIO";
  status: XmlCollectionStatus;
  erro_mensagem: string | null;
  updated_at: string;
  xml_watch_establishments: { id: string; cnpj: string; razao_social: string } | { id: string; cnpj: string; razao_social: string }[] | null;
};

function establishmentOf(row: TaskRow) {
  return Array.isArray(row.xml_watch_establishments) ? row.xml_watch_establishments[0] : row.xml_watch_establishments;
}

export default async function PainelPage({ searchParams }: { searchParams: Promise<{ ano?: string; mes?: string }> }) {
  const session = await requireOfficeSessionOrRedirect();
  const params = await searchParams;
  const fallback = previousClosedCompetencia();
  const ano = Number(params.ano) || fallback.competenciaAno;
  const mes = Number(params.mes) || fallback.competenciaMes;

  const { data: tasks, error } = await createAdminClient()
    .from("xml_collection_tasks")
    .select("id,competencia_ano,competencia_mes,tipo_documento,papel,status,erro_mensagem,updated_at,xml_watch_establishments(id,cnpj,razao_social)")
    .eq("competencia_ano", ano)
    .eq("competencia_mes", mes)
    .order("updated_at", { ascending: false });

  const todayCounts = await loadTodayCounts(createAdminClient());
  const rows = (error ? [] : (tasks as TaskRow[] | null)) ?? [];
  const needsAttention = new Set<XmlCollectionStatus>(["AGUARDANDO_INTERVENCAO", "FALHA", "EXPIRADA"]);

  return (
    <Shell session={session}>
      <TodaySummary counts={todayCounts} />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[#082240]">Painel mensal — {competenciaLabel(ano, mes)}</h1>
        <form className="flex items-center gap-2 text-sm" action={withBasePath("/painel")}>
          <input name="ano" defaultValue={ano} type="number" className="w-20 rounded border border-black/15 px-2 py-1" />
          <input name="mes" defaultValue={mes} type="number" min={1} max={12} className="w-16 rounded border border-black/15 px-2 py-1" />
          <button type="submit" className="rounded border border-black/15 px-3 py-1 hover:bg-black/5">Ver competência</button>
        </form>
      </div>

      {error && <p className="mt-4 text-sm text-red-700">Não foi possível carregar as tarefas.</p>}

      {!error && rows.length === 0 && (
        <p className="mt-8 text-sm text-black/60">Nenhuma tarefa para {competenciaLabel(ano, mes)} ainda. Use <Link href="/extracao/nova" className="underline">Nova extração</Link> para criar.</p>
      )}

      {rows.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded border border-black/10 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
                <th className="px-4 py-2">Empresa</th>
                <th className="px-4 py-2">Documento</th>
                <th className="px-4 py-2">Papel</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Última atualização</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const establishment = establishmentOf(row);
                return (
                  <tr key={row.id} className={`border-b border-black/5 last:border-0 ${needsAttention.has(row.status) ? "bg-red-50/40" : ""}`}>
                    <td className="px-4 py-2">
                      <Link href={`/pedidos/${row.id}`} className="font-medium text-[#082240] hover:underline">{establishment?.razao_social ?? "—"}</Link>
                      <div className="text-xs text-black/50">{establishment?.cnpj}</div>
                    </td>
                    <td className="px-4 py-2">{documentLabel(row.tipo_documento)}</td>
                    <td className="px-4 py-2">{roleLabel(row.papel)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[statusTone(row.status)]}`}>{STATUS_LABELS[row.status]}</span>
                      {row.erro_mensagem && <div className="mt-1 text-xs text-red-700">{row.erro_mensagem}</div>}
                    </td>
                    <td className="px-4 py-2 text-black/60">{new Date(row.updated_at).toLocaleString("pt-BR")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
