import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Só uma sessão de navegador opera uma empresa por vez (§3.5 da Descoberta) — trava com TTL para não ficar presa se a extensão cair no meio de uma execução. */
export const ESTABLISHMENT_LOCK_TTL_MS = 30 * 60 * 1000;

export function isEligibleForMonthlyRun(establishment: { ativo: boolean; situacaoCadastral: string | null }) {
  return establishment.ativo && establishment.situacaoCadastral !== "Baixada";
}

export type AccessContext = { type: "PROCURACAO"; grupo: string; posicao: number | null } | { type: "PROPRIO" };

export function resolveAccessContext(establishment: { certificadoTipo: string; procuracaoGrupo: string | null; procuracaoPosicao: number | null }): AccessContext {
  if (establishment.certificadoTipo === "ESCRITORIO_PROCURACAO") {
    if (!establishment.procuracaoGrupo) throw new Error("PROCURACAO_GRUPO_AUSENTE");
    return { type: "PROCURACAO", grupo: establishment.procuracaoGrupo, posicao: establishment.procuracaoPosicao };
  }
  return { type: "PROPRIO" };
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
