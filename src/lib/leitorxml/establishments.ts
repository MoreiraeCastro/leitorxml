import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findProcurationPosition } from "./procuration-index";

/** Só uma sessão de navegador opera uma empresa por vez (§3.5 da Descoberta) — trava com TTL para não ficar presa se a extensão cair no meio de uma execução. */
export const ESTABLISHMENT_LOCK_TTL_MS = 30 * 60 * 1000;

export function isEligibleForMonthlyRun(establishment: { ativo: boolean; situacaoCadastral: string | null }) {
  return establishment.ativo && establishment.situacaoCadastral !== "Baixada";
}

/** grupo/posicao nulos = ainda não descobertos — a extensão entra em modo descoberta em vez de travar pedindo cadastro manual. */
export type AccessContext = { type: "PROCURACAO"; grupo: string | null; posicao: number | null } | { type: "PROPRIO" };

/**
 * O índice de procurações (populado pela própria extensão ao descobrir onde
 * um CNPJ está) é a fonte de verdade — o grupo/posição preenchidos à mão no
 * cadastro do estabelecimento são só uma dica opcional pra encurtar a busca
 * na primeira vez, nunca uma exigência.
 */
export async function resolveAccessContext(
  db: SupabaseClient,
  establishment: { cnpj: string; certificadoTipo: string; procuracaoGrupo: string | null; procuracaoPosicao: number | null },
): Promise<AccessContext> {
  if (establishment.certificadoTipo !== "ESCRITORIO_PROCURACAO") return { type: "PROPRIO" };
  const indexed = await findProcurationPosition(db, establishment.cnpj);
  if (indexed) return { type: "PROCURACAO", grupo: indexed.procuracaoGrupo, posicao: indexed.posicao };
  return { type: "PROCURACAO", grupo: establishment.procuracaoGrupo, posicao: establishment.procuracaoPosicao };
}

/** Compare-and-swap atômico: só trava se estiver livre ou com trava expirada. Evita corrida entre chamadas concorrentes de "próxima tarefa". */
export async function acquireEstablishmentLock(db: SupabaseClient, establishmentId: string, userId: string, now: Date = new Date()) {
  const staleBefore = new Date(now.getTime() - ESTABLISHMENT_LOCK_TTL_MS).toISOString();
  const { data, error } = await db
    .from("xml_watch_establishments")
    .update({ locked_by_user_id: userId, locked_at: now.toISOString() })
    .eq("id", establishmentId)
    .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("ESTABLISHMENT_LOCK_FAILED");
  return Boolean(data);
}

export async function releaseEstablishmentLock(db: SupabaseClient, establishmentId: string) {
  const { error } = await db.from("xml_watch_establishments").update({ locked_by_user_id: null, locked_at: null }).eq("id", establishmentId);
  if (error) throw new Error("ESTABLISHMENT_UNLOCK_FAILED");
}
