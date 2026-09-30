import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProcurationIndexEntry = { procuracaoGrupo: string; posicao: number; cnpj: string; situacaoCadastral: string };

/**
 * A lista de procurações do Fisco Fácil não identifica a empresa antes de
 * clicar (§3.2 da Descoberta), e cada posição leva a uma lista paginada com
 * VÁRIAS empresas (confirmado ao vivo, 2026-09-30) — não uma só. A extensão
 * descobre "posição X contém CNPJ Y" ao buscar o CNPJ alvo lá dentro, e
 * reporta aqui para as próximas coletas irem direto à posição certa.
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
  const { error } = await db.from("xml_watch_procuration_index").upsert(rows, { onConflict: "procuracao_grupo,posicao,cnpj" });
  if (error) throw new Error("PROCURATION_INDEX_UPSERT_FAILED");
}

/** Última posição conhecida (grupo+posição) onde esse CNPJ foi visto — null se nunca indexado. */
export async function findProcurationPosition(db: SupabaseClient, cnpj: string) {
  const { data, error } = await db
    .from("xml_watch_procuration_index")
    .select("procuracao_grupo,posicao")
    .eq("cnpj", cnpj)
    .order("last_verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("PROCURATION_INDEX_LOOKUP_FAILED");
  return data ? { procuracaoGrupo: data.procuracao_grupo as string, posicao: data.posicao as number } : null;
}
