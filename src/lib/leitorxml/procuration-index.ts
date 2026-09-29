import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProcurationIndexEntry = { procuracaoGrupo: string; posicao: number; cnpj: string | null; situacaoCadastral: string | null };

/**
 * A lista de procurações do Fisco Fácil não identifica a empresa antes de
 * clicar (§3.2 da Descoberta) — a extensão descobre "posição X = CNPJ Y" ao
 * entrar, e reporta aqui para as próximas coletas irem direto à posição certa.
 */
export async function upsertProcurationIndex(db: SupabaseClient, entries: ProcurationIndexEntry[]) {
  if (!entries.length) return;
  const rows = entries.map((entry) => ({
    procuracao_grupo: entry.procuracaoGrupo,
    posicao: entry.posicao,
    cnpj: entry.cnpj,
    situacao_cadastral: entry.situacaoCadastral,
    last_verified_at: new Date().toISOString(),
  }));
  const { error } = await db.from("xml_watch_procuration_index").upsert(rows, { onConflict: "procuracao_grupo,posicao" });
  if (error) throw new Error("PROCURATION_INDEX_UPSERT_FAILED");
}
