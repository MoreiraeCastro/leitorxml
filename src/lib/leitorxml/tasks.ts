import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { acquireEstablishmentLock, isEligibleForMonthlyRun, releaseEstablishmentLock, resolveAccessContext } from "./establishments";
import { upsertProcurationIndex } from "./procuration-index";
import { XML_COLLECTION_DOCUMENT_COMBINATIONS } from "./types";

/** Competência fechada mais recente: se hoje é setembro, o mês fechado é agosto. */
export function previousClosedCompetencia(now: Date = new Date()) {
  const currentMonthZeroBased = now.getUTCMonth();
  if (currentMonthZeroBased === 0) return { competenciaAno: now.getUTCFullYear() - 1, competenciaMes: 12 };
  return { competenciaAno: now.getUTCFullYear(), competenciaMes: currentMonthZeroBased };
}

type EstablishmentRow = { id: string; ativo: boolean; situacao_cadastral: string | null };

function buildTaskRows(establishments: EstablishmentRow[], competencia: { competenciaAno: number; competenciaMes: number }) {
  return establishments
    .filter((establishment) => isEligibleForMonthlyRun({ ativo: establishment.ativo, situacaoCadastral: establishment.situacao_cadastral }))
    .flatMap((establishment) =>
      XML_COLLECTION_DOCUMENT_COMBINATIONS.map((combo) => ({
        establishment_id: establishment.id,
        competencia_ano: competencia.competenciaAno,
        competencia_mes: competencia.competenciaMes,
        tipo_documento: combo.tipoDocumento,
        papel: combo.papel,
        status: "AGENDADA" as const,
      })),
    );
}

async function insertTaskRows(db: SupabaseClient, rows: ReturnType<typeof buildTaskRows>) {
  if (!rows.length) return 0;
  const { error, count } = await db
    .from("xml_collection_tasks")
    .upsert(rows, { onConflict: "establishment_id,competencia_ano,competencia_mes,tipo_documento,papel", ignoreDuplicates: true, count: "exact" });
  if (error) throw new Error("TASKS_GENERATION_FAILED");
  return count ?? 0;
}

/** Disparo mensal: todo estabelecimento ativo e não "Baixada" entra na competência informada. Idempotente pela UNIQUE da tabela — rodar de novo não duplica. */
export async function generateMonthlyTasks(db: SupabaseClient, competencia: { competenciaAno: number; competenciaMes: number }) {
  const { data: establishments, error } = await db
    .from("xml_watch_establishments")
    .select("id,ativo,situacao_cadastral")
    .eq("ativo", true)
    .or("situacao_cadastral.is.null,situacao_cadastral.neq.Baixada");
  if (error) throw new Error("ESTABLISHMENTS_LOOKUP_FAILED");
  const rows = buildTaskRows(establishments ?? [], competencia);
  return { establishments: establishments?.length ?? 0, tasksCreated: await insertTaskRows(db, rows) };
}

/** Criação ad-hoc a partir da seleção manual de estabelecimentos (futura tela "Nova extração"). */
export async function createTasksForEstablishments(db: SupabaseClient, input: { establishmentIds: string[]; competenciaAno: number; competenciaMes: number }) {
  const { data: establishments, error } = await db
    .from("xml_watch_establishments")
    .select("id,ativo,situacao_cadastral")
    .in("id", input.establishmentIds);
  if (error) throw new Error("ESTABLISHMENTS_LOOKUP_FAILED");
  const rows = buildTaskRows(establishments ?? [], input);
  const eligibleCount = new Set(rows.map((row) => row.establishment_id)).size;
  return { establishments: eligibleCount, tasksCreated: await insertTaskRows(db, rows), skipped: input.establishmentIds.length - eligibleCount };
}

export type DiscoveredEstablishment = {
  cnpj: string;
  razaoSocial: string;
  inscricaoEstadual: string | null;
  situacaoCadastral: string;
  procuracaoGrupo: string;
  posicao: number;
};

/**
 * Uma empresa encontrada pela extensão durante a varredura de uma procuração
 * — cadastra/atualiza o estabelecimento, cacheia (grupo, posição, CNPJ) no
 * índice, e cria as tarefas do mês corrente se não for "Baixada". A extensão
 * é quem descobre a carteira agora, não um cadastro manual prévio no Portal.
 */
export async function registerDiscoveredEstablishment(db: SupabaseClient, input: DiscoveredEstablishment) {
  const { data: establishment, error } = await db
    .from("xml_watch_establishments")
    .upsert(
      {
        cnpj: input.cnpj,
        razao_social: input.razaoSocial,
        inscricao_estadual: input.inscricaoEstadual,
        situacao_cadastral: input.situacaoCadastral,
        certificado_tipo: "ESCRITORIO_PROCURACAO",
        procuracao_grupo: input.procuracaoGrupo,
        procuracao_posicao: input.posicao,
        ativo: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cnpj" },
    )
    .select("id")
    .single();
  if (error || !establishment) throw new Error("ESTABLISHMENT_UPSERT_FAILED");

  await upsertProcurationIndex(db, [
    { procuracaoGrupo: input.procuracaoGrupo, posicao: input.posicao, cnpj: input.cnpj, situacaoCadastral: input.situacaoCadastral },
  ]);

  if (!isEligibleForMonthlyRun({ ativo: true, situacaoCadastral: input.situacaoCadastral })) {
    return { establishmentId: establishment.id as string, tasksCreated: 0 };
  }

  const competencia = previousClosedCompetencia();
  const { tasksCreated } = await createTasksForEstablishments(db, { establishmentIds: [establishment.id as string], ...competencia });
  return { establishmentId: establishment.id as string, tasksCreated };
}

/**
 * Quanto esperar a SEFAZ processar um pedido antes de pedir revisão manual. No dia 10-11 (pico) o
 * processamento chega a levar ATÉ 5 DIAS (observado pelo usuário), então o prazo é 7. É contado DESDE O
 * PEDIDO (prazo_alerta_at, gravado ao virar SOLICITADO) — não pelo updated_at, que é renovado a cada
 * conferência e tornaria a regra "24h sem avanço" tanto errada (escalaria no dia seguinte) quanto inútil.
 */
export const SEFAZ_MAX_WAIT_DAYS = 7;

/** Escalona para revisão manual as solicitações que passaram do prazo de espera da SEFAZ (§4 da Descoberta: a previsão de conclusão da SEFAZ não é um sinal confiável). */
export async function escalateStaleProcessing(db: SupabaseClient, options: { now?: Date } = {}) {
  const now = options.now ?? new Date();
  const { data, error } = await db
    .from("xml_collection_tasks")
    .update({ status: "AGUARDANDO_INTERVENCAO", erro_mensagem: `Sem processamento da SEFAZ no prazo de ${SEFAZ_MAX_WAIT_DAYS} dias — verificar manualmente.`, updated_at: now.toISOString() })
    .in("status", ["SOLICITADO", "PROCESSANDO_SEFAZ"])
    .lt("prazo_alerta_at", now.toISOString())
    .select("id");
  if (error) throw new Error("STALE_TASKS_ESCALATION_FAILED");
  return { escalated: data?.length ?? 0 };
}

const CANDIDATE_COLUMNS =
  "id,establishment_id,competencia_ano,competencia_mes,tipo_documento,papel,status,tentativas,xml_watch_establishments(id,cnpj,razao_social,situacao_cadastral,certificado_tipo,procuracao_grupo,procuracao_posicao)";

async function fetchClaimCandidates(db: SupabaseClient, onlyEstablishmentId?: string) {
  let query = db.from("xml_collection_tasks").select(CANDIDATE_COLUMNS).in("status", ["AGENDADA", "NA_FILA"]);
  if (onlyEstablishmentId) query = query.eq("establishment_id", onlyEstablishmentId);
  const { data, error } = await query.order("competencia_ano", { ascending: true }).order("competencia_mes", { ascending: true }).limit(50);
  if (error) throw new Error("NEXT_TASK_LOOKUP_FAILED");
  return data ?? [];
}

async function tryClaimFromCandidates(db: SupabaseClient, userId: string, now: Date, candidates: Awaited<ReturnType<typeof fetchClaimCandidates>>) {
  const attempted = new Set<string>();
  for (const candidate of candidates) {
    if (attempted.has(candidate.establishment_id)) continue;
    attempted.add(candidate.establishment_id);
    const locked = await acquireEstablishmentLock(db, candidate.establishment_id, userId, now);
    if (!locked) continue;
    const { data: claimed, error: claimError } = await db
      .from("xml_collection_tasks")
      .update({ status: "AUTENTICANDO", tentativas: candidate.tentativas + 1, updated_at: now.toISOString() })
      .eq("id", candidate.id)
      .in("status", ["AGENDADA", "NA_FILA"])
      .select("*")
      .maybeSingle();
    if (claimError) throw new Error("TASK_CLAIM_FAILED");
    if (!claimed) {
      await releaseEstablishmentLock(db, candidate.establishment_id);
      continue;
    }
    const establishment = Array.isArray(candidate.xml_watch_establishments) ? candidate.xml_watch_establishments[0] : candidate.xml_watch_establishments;
    const accessContext = await resolveAccessContext(db, {
      cnpj: establishment.cnpj,
      certificadoTipo: establishment.certificado_tipo,
      procuracaoGrupo: establishment.procuracao_grupo,
      procuracaoPosicao: establishment.procuracao_posicao,
    });
    return { task: claimed, establishment, accessContext };
  }
  return null;
}

/**
 * Reivindica a próxima tarefa elegível para um colaborador: percorre
 * candidatas (AGENDADA/NA_FILA) por competência mais antiga primeiro,
 * tentando travar o estabelecimento (uma sessão de navegador por empresa).
 * A primeira que conseguir travar vira AUTENTICANDO e é retornada.
 *
 * Com `preferEstablishmentId`, tenta antes as tarefas pendentes dessa empresa
 * (a extensão já está dentro dela: pede as 3 combinações em sequência, sem
 * voltar ao modal de procurações) e só então cai na fila geral.
 */
export async function claimNextTask(db: SupabaseClient, userId: string, now: Date = new Date(), options: { preferEstablishmentId?: string } = {}) {
  if (options.preferEstablishmentId) {
    const sameCompany = await tryClaimFromCandidates(db, userId, now, await fetchClaimCandidates(db, options.preferEstablishmentId));
    if (sameCompany) return sameCompany;
  }
  return tryClaimFromCandidates(db, userId, now, await fetchClaimCandidates(db));
}

const TRACKING_COLUMNS =
  "id,establishment_id,competencia_ano,competencia_mes,tipo_documento,papel,status,sefaz_referencia,ultima_verificacao_at,xml_watch_establishments(id,cnpj,razao_social,situacao_cadastral,certificado_tipo,procuracao_grupo,procuracao_posicao)";

/**
 * Próxima empresa a ACOMPANHAR: a que tem tarefas já solicitadas (SOLICITADO / PROCESSANDO_SEFAZ / PRONTO_PARA_BAIXAR) há mais
 * tempo sem atualização. Devolve a empresa, como acessá-la e TODAS as tarefas pendentes dela — a extensão
 * entra na empresa uma vez, abre a aba Solicitações e confere/baixa cada uma. Trava a empresa (mesmo
 * mecanismo da fila de solicitações); `excludeEstablishmentIds` evita voltar numa empresa já visitada no
 * mesmo lote (tarefas ainda "aguardando processamento" continuam pendentes e seriam reclamadas de novo).
 */
/**
 * Acompanhamento AUTOMÁTICO: uma solicitação só entra na vez se (a) já está pronta pra baixar — isso nunca espera —
 * ou (b) não foi conferida nas últimas `staleHours` horas. Sem isso o automático voltaria no Fisco Fácil a cada
 * rodada pra ver "Aguardando processamento" de pedidos que levam dias.
 */
export function isDueForTracking(row: { status: string; ultima_verificacao_at: string | null }, staleHours: number | undefined, now: Date) {
  if (staleHours === undefined || row.status === "PRONTO_PARA_BAIXAR" || !row.ultima_verificacao_at) return true;
  return now.getTime() - new Date(row.ultima_verificacao_at).getTime() >= staleHours * 3600_000;
}

/** Quanto há a conferir/baixar agora, SEM travar empresa nenhuma (a extensão consulta isso pra decidir se vale abrir o Fisco Fácil). */
export async function summarizeTrackingNeeds(db: SupabaseClient, options: { staleHours?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const { data, error } = await db.from("xml_collection_tasks").select("id,establishment_id,status,ultima_verificacao_at").in("status", ["SOLICITADO", "PROCESSANDO_SEFAZ", "PRONTO_PARA_BAIXAR"]).limit(2000);
  if (error) throw new Error("TRACKING_SUMMARY_FAILED");
  const due = (data ?? []).filter((row) => isDueForTracking(row, options.staleHours, now));
  return {
    paraBaixar: due.filter((row) => row.status === "PRONTO_PARA_BAIXAR").length,
    aConferir: due.filter((row) => row.status !== "PRONTO_PARA_BAIXAR").length,
    empresas: new Set(due.map((row) => row.establishment_id)).size,
    aguardandoSefaz: (data ?? []).length - due.length,
  };
}

export async function claimNextTrackingBatch(db: SupabaseClient, userId: string, options: { excludeEstablishmentIds?: string[]; onlyEstablishmentId?: string; staleHours?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const excluded = new Set(options.excludeEstablishmentIds ?? []);
  let query = db.from("xml_collection_tasks").select(TRACKING_COLUMNS).in("status", ["SOLICITADO", "PROCESSANDO_SEFAZ", "PRONTO_PARA_BAIXAR"]);
  // `onlyEstablishmentId`: a esteira conferindo a aba Solicitações da empresa que ACABOU de solicitar (a trava é do mesmo usuário).
  if (options.onlyEstablishmentId) query = query.eq("establishment_id", options.onlyEstablishmentId);
  const { data, error } = await query.order("updated_at", { ascending: true }).limit(300);
  if (error) throw new Error("TRACKING_LOOKUP_FAILED");

  const byEstablishment = new Map<string, NonNullable<typeof data>>();
  for (const row of data ?? []) {
    if (excluded.has(row.establishment_id) || !isDueForTracking(row, options.staleHours, now)) continue;
    byEstablishment.set(row.establishment_id, [...(byEstablishment.get(row.establishment_id) ?? []), row]);
  }
  for (const [establishmentId, rows] of byEstablishment) {
    if (!(await acquireEstablishmentLock(db, establishmentId, userId, now))) continue;
    const establishment = Array.isArray(rows[0].xml_watch_establishments) ? rows[0].xml_watch_establishments[0] : rows[0].xml_watch_establishments;
    const accessContext = await resolveAccessContext(db, {
      cnpj: establishment.cnpj,
      certificadoTipo: establishment.certificado_tipo,
      procuracaoGrupo: establishment.procuracao_grupo,
      procuracaoPosicao: establishment.procuracao_posicao,
    });
    return {
      establishment,
      accessContext,
      tasks: rows.map((row) => ({
        id: row.id,
        tipoDocumento: row.tipo_documento,
        papel: row.papel,
        competenciaAno: row.competencia_ano,
        competenciaMes: row.competencia_mes,
        status: row.status,
        sefazReferencia: row.sefaz_referencia,
      })),
    };
  }
  return null;
}
