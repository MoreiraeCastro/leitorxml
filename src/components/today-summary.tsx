import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

type Counts = { agendadas: number; aguardandoSefaz: number; prontasParaBaixar: number; paraRevisar: number; comProblema: number; semSharePoint: number };

async function count(db: SupabaseClient, statuses: string[]) {
  const { count: total } = await db.from("xml_collection_tasks").select("id", { count: "exact", head: true }).in("status", statuses);
  return total ?? 0;
}

export async function loadTodayCounts(db: SupabaseClient): Promise<Counts> {
  const [agendadas, aguardandoSefaz, prontasParaBaixar, paraRevisar, comProblema, semSharePoint] = await Promise.all([
    count(db, ["AGENDADA", "NA_FILA"]),
    count(db, ["AUTENTICANDO", "SELECIONANDO_CONTEXTO", "SOLICITADO", "PROCESSANDO_SEFAZ"]),
    count(db, ["PRONTO_PARA_BAIXAR", "BAIXANDO", "VALIDANDO"]),
    count(db, ["DISPONIVEL_REVISAO"]),
    count(db, ["FALHA", "AGUARDANDO_INTERVENCAO", "EXPIRADA"]),
    db.from("xml_collection_tasks").select("id", { count: "exact", head: true }).in("status", ["DISPONIVEL_REVISAO", "REVISADO"]).is("sharepoint_path", null).not("storage_path_zip", "is", null).then((result) => result.count ?? 0),
  ]);
  return { agendadas, aguardandoSefaz, prontasParaBaixar, paraRevisar, comProblema, semSharePoint };
}

/** A próxima ação, em uma frase, na ordem do que mais urgente pra quem opera. */
export function nextStep(counts: Counts) {
  if (counts.comProblema > 0) return { tone: "danger", text: `${counts.comProblema} tarefa(s) com problema — abra as marcadas em vermelho na tabela abaixo e veja a mensagem de erro.` };
  if (counts.prontasParaBaixar > 0) return { tone: "warn", text: `${counts.prontasParaBaixar} arquivo(s) pronto(s) pra baixar no Fisco Fácil. Deixe o Chrome aberto com o Fisco Fácil logado (a extensão baixa sozinha) ou clique em “Conferir resultados e baixar ZIPs”.` };
  if (counts.agendadas > 0) return { tone: "info", text: `${counts.agendadas} solicitação(ões) ainda não foram pedidas ao Fisco Fácil. Na extensão, clique em “Iniciar esteira de solicitações”.` };
  if (counts.paraRevisar > 0) return { tone: "info", text: `${counts.paraRevisar} arquivo(s) esperando revisão. Abra cada tarefa da tabela e use “Marcar como revisado”.` };
  if (counts.aguardandoSefaz > 0) return { tone: "ok", text: `Nada a fazer agora. ${counts.aguardandoSefaz} solicitação(ões) aguardando o SEFAZ processar — o acompanhamento automático confere sozinho.` };
  return { tone: "ok", text: "Tudo em dia." };
}

const BOX: Record<string, string> = {
  danger: "border-red-200 bg-red-50 text-red-800",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

export function TodaySummary({ counts }: { counts: Counts }) {
  const step = nextStep(counts);
  const cards: Array<[string, number, string?]> = [
    ["Ainda não solicitadas", counts.agendadas],
    ["Aguardando o SEFAZ", counts.aguardandoSefaz],
    ["Prontas pra baixar", counts.prontasParaBaixar],
    ["Para revisar", counts.paraRevisar],
    ["Com problema", counts.comProblema],
    ["Sem envio ao SharePoint", counts.semSharePoint, "/sharepoint"],
  ];
  return (
    <section className="mb-6">
      <div className={`rounded border px-4 py-3 text-sm ${BOX[step.tone]}`}>
        <span className="font-semibold">O que fazer agora: </span>{step.text}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map(([label, value, href]) => {
          const inner = (
            <div className="rounded border border-black/10 bg-white px-3 py-2">
              <div className="text-2xl font-semibold text-[#082240]">{value}</div>
              <div className="text-xs text-black/50">{label}</div>
            </div>
          );
          return href ? <Link key={label} href={href}>{inner}</Link> : <div key={label}>{inner}</div>;
        })}
      </div>
    </section>
  );
}
