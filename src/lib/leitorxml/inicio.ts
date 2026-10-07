/**
 * Lógica pura da tela Início: agrupar as tarefas por empresa (uma linha por empresa, com 3 etiquetas), contar por
 * "fase" e decidir qual é a próxima ação. Sem banco nem React, pra poder ser testada.
 */

export type Phase = "PEDIR" | "SEFAZ" | "PRONTA" | "REVISAR" | "REVISADO" | "SEM_DOCS" | "PROBLEMA";

const PHASE_BY_STATUS: Record<string, Phase> = {
  AGENDADA: "PEDIR",
  NA_FILA: "PEDIR",
  AUTENTICANDO: "SEFAZ",
  SELECIONANDO_CONTEXTO: "SEFAZ",
  SOLICITADO: "SEFAZ",
  PROCESSANDO_SEFAZ: "SEFAZ",
  PRONTO_PARA_BAIXAR: "PRONTA",
  BAIXANDO: "PRONTA",
  VALIDANDO: "PRONTA",
  SALVANDO_SHAREPOINT: "PRONTA",
  DISPONIVEL_REVISAO: "REVISAR",
  REVISADO: "REVISADO",
  SEM_DOCUMENTOS: "SEM_DOCS",
  EXPIRADA: "PROBLEMA",
  FALHA: "PROBLEMA",
  AGUARDANDO_INTERVENCAO: "PROBLEMA",
};

export function phaseOf(status: string): Phase {
  return PHASE_BY_STATUS[status] ?? "PEDIR";
}

/** Rótulo curto da etiqueta; problemas dizem qual é (Expirada / Falha). */
export function pillLabel(status: string): string {
  switch (status) {
    case "EXPIRADA": return "Expirada";
    case "FALHA": return "Falha";
    case "AGUARDANDO_INTERVENCAO": return "Precisa de ajuda";
    case "BAIXANDO": return "Baixando";
    case "VALIDANDO": return "Validando";
    default:
      return { PEDIR: "Para pedir", SEFAZ: "No SEFAZ", PRONTA: "Pronta", REVISAR: "Revisar", REVISADO: "Revisado", SEM_DOCS: "Sem docs", PROBLEMA: "Problema" }[phaseOf(status)];
  }
}

/** As três combinações de cada empresa, na ordem das colunas. */
export const SLOTS = [
  { key: "NFE_EMITENTE", tipo: "NFE", papel: "EMITENTE", label: "NF-e emitente" },
  { key: "NFE_DESTINATARIO", tipo: "NFE", papel: "DESTINATARIO", label: "NF-e destinatário" },
  { key: "NFCE_EMITENTE", tipo: "NFCE", papel: "EMITENTE", label: "NFC-e" },
] as const;
export type SlotKey = (typeof SLOTS)[number]["key"];

export type TaskInput = { id: string; status: string; tipo_documento: string; papel: string; erro_mensagem?: string | null; establishmentId: string; cnpj: string; razaoSocial: string };
export type CompanyTask = { id: string; status: string; phase: Phase; erro: string | null };
export type CompanyRow = { establishmentId: string; cnpj: string; razaoSocial: string; tasks: Partial<Record<SlotKey, CompanyTask>> };

export function groupByCompany(tasks: TaskInput[]): CompanyRow[] {
  const byCompany = new Map<string, CompanyRow>();
  for (const task of tasks) {
    const row = byCompany.get(task.establishmentId) ?? { establishmentId: task.establishmentId, cnpj: task.cnpj, razaoSocial: task.razaoSocial, tasks: {} };
    row.tasks[`${task.tipo_documento}_${task.papel}` as SlotKey] = { id: task.id, status: task.status, phase: phaseOf(task.status), erro: task.erro_mensagem ?? null };
    byCompany.set(task.establishmentId, row);
  }
  return [...byCompany.values()].sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial, "pt-BR"));
}

export type Counts = Record<Phase, number> & { empresas: number; empresasRecebidas: number };

/** Uma empresa está "recebida" quando todas as suas tarefas já trouxeram resultado (ou confirmaram que não há documentos). */
export function summarize(rows: CompanyRow[]): Counts {
  const counts: Counts = { PEDIR: 0, SEFAZ: 0, PRONTA: 0, REVISAR: 0, REVISADO: 0, SEM_DOCS: 0, PROBLEMA: 0, empresas: rows.length, empresasRecebidas: 0 };
  const received = new Set<Phase>(["REVISAR", "REVISADO", "SEM_DOCS"]);
  for (const row of rows) {
    const tasks = Object.values(row.tasks);
    for (const task of tasks) counts[task.phase] += 1;
    if (tasks.length && tasks.every((task) => received.has(task.phase))) counts.empresasRecebidas += 1;
  }
  return counts;
}

export type FilterKey = "TUDO" | "PEDIR" | "SEFAZ" | "PRONTA" | "REVISAR" | "PROBLEMA";
export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "TUDO", label: "Tudo" },
  { key: "PEDIR", label: "Para pedir" },
  { key: "SEFAZ", label: "No SEFAZ" },
  { key: "PRONTA", label: "Prontas" },
  { key: "REVISAR", label: "Para revisar" },
  { key: "PROBLEMA", label: "Problemas" },
];

export function parseFilter(value: string | undefined): FilterKey {
  return FILTERS.some((filter) => filter.key === value) ? (value as FilterKey) : "TUDO";
}

/** Mantém só as empresas que têm pelo menos uma tarefa na fase pedida. */
export function filterRows(rows: CompanyRow[], filter: FilterKey, search = ""): CompanyRow[] {
  const term = search.trim().toLowerCase().replace(/[.\-/]/g, "");
  return rows.filter((row) => {
    if (filter !== "TUDO" && !Object.values(row.tasks).some((task) => task.phase === filter)) return false;
    if (!term) return true;
    return row.razaoSocial.toLowerCase().includes(term) || row.cnpj.replace(/\D/g, "").includes(term);
  });
}

export type NextAction = { tone: "ok" | "info" | "warn" | "danger" | "neutral"; title: string; detail: string; cta?: { label: string; href: string; external?: boolean } };

export const FISCO_URL = "https://ssacert.fazenda.rj.gov.br/ssa/certificadoWeb";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A única coisa que a pessoa precisa fazer agora, por ordem de urgência. */
export function nextAction(counts: Counts, competencia: string): NextAction {
  if (counts.empresas === 0) return { tone: "neutral", title: `Nenhuma tarefa em ${competencia}`, detail: "Crie as tarefas do mês para começar." };
  if (counts.PROBLEMA > 0) return { tone: "danger", title: `Resolver ${plural(counts.PROBLEMA, "problema", "problemas")}`, detail: "Use “Pedir de novo” nas tarefas em vermelho.", cta: { label: "Ver problemas", href: "?f=PROBLEMA" } };
  if (counts.PRONTA > 0) return { tone: "info", title: `Baixar ${plural(counts.PRONTA, "pronta", "prontas")}`, detail: "Abra o Fisco Fácil e deixe a aba aberta: a extensão baixa sozinha.", cta: { label: "Abrir Fisco Fácil", href: FISCO_URL, external: true } };
  if (counts.PEDIR > 0) return { tone: "info", title: `Pedir ${plural(counts.PEDIR, "tarefa", "tarefas")}`, detail: "Abra o Fisco Fácil e, na extensão, clique em “Trabalhar agora”.", cta: { label: "Abrir Fisco Fácil", href: FISCO_URL, external: true } };
  if (counts.REVISAR > 0) return { tone: "ok", title: `Revisar ${plural(counts.REVISAR, "arquivo", "arquivos")}`, detail: "Abra cada um, confira e marque como revisado.", cta: { label: "Ver para revisar", href: "?f=REVISAR" } };
  if (counts.SEFAZ > 0) return { tone: "neutral", title: `Aguardando o SEFAZ (${counts.SEFAZ})`, detail: "A extensão confere sozinha. Pode levar até 5 dias." };
  return { tone: "ok", title: "Tudo em dia", detail: `${competencia} concluído.` };
}
