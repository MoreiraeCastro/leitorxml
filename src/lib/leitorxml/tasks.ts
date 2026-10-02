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

/** Escalona para revisão manual quem ficou parado em PROCESSANDO_SEFAZ por mais de 24h sem atualização — a "previsão de conclusão" da SEFAZ não é um sinal confiável (§4 da Descoberta). */
export async function escalateStaleProcessing(db: SupabaseClient, options: { olderThanHours?: number; now?: Date } = {}) {
  const olderThanHours = options.olderThanHours ?? 24;
  const now = options.now ?? new Date();
  const threshold = new Date(now.getTime() - olderThanHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("xml_collection_tasks")
    .update({ status: "AGUARDANDO_INTERVENCAO", erro_mensagem: `Sem avanço da SEFAZ por mais de ${olderThanHours}h — verificar manualmente.`, updated_at: now.toISOString() })
    .eq("status", "PROCESSANDO_SEFAZ")
    .lt("updated_at", threshold)
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
  "id,establishment_id,competencia_ano,competencia_mes,tipo_documento,papel,status,sefaz_referencia,xml_watch_establishments(id,cnpj,razao_social,situacao_cadastral,certificado_tipo,procuracao_grupo,procuracao_posicao)";

/**
 * Próxima empresa a ACOMPANHAR: a que tem tarefas já solicitadas (SOLICITADO / PROCESSANDO_SEFAZ) há mais
 * tempo sem atualização. Devolve a empresa, como acessá-la e TODAS as tarefas pendentes dela — a extensão
 * entra na empresa uma vez, abre a aba Solicitações e confere/baixa cada uma. Trava a empresa (mesmo
 * mecanismo da fila de solicitações); `excludeEstablishmentIds` evita voltar numa empresa já visitada no
 * mesmo lote (tarefas ainda "aguardando processamento" continuam pendentes e seriam reclamadas de novo).
 */
export async function claimNextTrackingBatch(db: SupabaseClient, userId: string, options: { excludeEstablishmentIds?: string[]; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const excluded = new Set(options.excludeEstablishmentIds ?? []);
  const { data, error } = await db
    .from("xml_collection_tasks")
    .select(TRACKING_COLUMNS)
    .in("status", ["SOLICITADO", "PROCESSANDO_SEFAZ"])
    .order("updated_at", { ascending: true })
    .limit(300);
  if (error) throw new Error("TRACKING_LOOKUP_FAILED");

  const byEstablishment = new Map<string, NonNullable<typeof data>>();
  for (const row of data ?? []) {
    if (excluded.has(row.establishment_id)) continue;
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
