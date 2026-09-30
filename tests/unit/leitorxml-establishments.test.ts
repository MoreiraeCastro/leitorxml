import { describe, expect, it } from "vitest";
import { acquireEstablishmentLock, isEligibleForMonthlyRun, releaseEstablishmentLock, resolveAccessContext } from "@/lib/leitorxml/establishments";

describe("isEligibleForMonthlyRun", () => {
  it("aceita empresa ativa e não baixada", () => {
    expect(isEligibleForMonthlyRun({ ativo: true, situacaoCadastral: "Habilitada" })).toBe(true);
  });
  it("aceita situação cadastral desconhecida (ainda não sincronizada)", () => {
    expect(isEligibleForMonthlyRun({ ativo: true, situacaoCadastral: null })).toBe(true);
  });
  it("rejeita empresa baixada mesmo se ativa", () => {
    expect(isEligibleForMonthlyRun({ ativo: true, situacaoCadastral: "Baixada" })).toBe(false);
  });
  it("rejeita empresa inativa", () => {
    expect(isEligibleForMonthlyRun({ ativo: false, situacaoCadastral: "Habilitada" })).toBe(false);
  });
});

function fakeProcurationIndexDb(row: { procuracao_grupo: string; posicao: number } | null) {
  return {
    from(table: string) {
      if (table !== "xml_watch_procuration_index") throw new Error(`tabela inesperada no fake: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: row, error: null }),
              }),
            }),
          }),
        }),
      };
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("resolveAccessContext", () => {
  it("usa o índice quando o CNPJ já foi descoberto, ignorando a dica do cadastro", async () => {
    const db = fakeProcurationIndexDb({ procuracao_grupo: "SUBFIN", posicao: 3 });
    await expect(
      resolveAccessContext(db, { cnpj: "28955848000193", certificadoTipo: "ESCRITORIO_PROCURACAO", procuracaoGrupo: "OUTRO", procuracaoPosicao: 99 }),
    ).resolves.toEqual({ type: "PROCURACAO", grupo: "SUBFIN", posicao: 3 });
  });
  it("cai para a dica manual do cadastro quando o CNPJ ainda não foi indexado", async () => {
    const db = fakeProcurationIndexDb(null);
    await expect(
      resolveAccessContext(db, { cnpj: "28955848000193", certificadoTipo: "ESCRITORIO_PROCURACAO", procuracaoGrupo: "SUBFIN", procuracaoPosicao: 5 }),
    ).resolves.toEqual({ type: "PROCURACAO", grupo: "SUBFIN", posicao: 5 });
  });
  it("retorna grupo/posição nulos quando nada é conhecido — extensão entra em modo descoberta", async () => {
    const db = fakeProcurationIndexDb(null);
    await expect(
      resolveAccessContext(db, { cnpj: "28955848000193", certificadoTipo: "ESCRITORIO_PROCURACAO", procuracaoGrupo: null, procuracaoPosicao: null }),
    ).resolves.toEqual({ type: "PROCURACAO", grupo: null, posicao: null });
  });
  it("resolve certificado próprio sem consultar o índice", async () => {
    const db = fakeProcurationIndexDb(null);
    await expect(
      resolveAccessContext(db, { cnpj: "28955848000193", certificadoTipo: "PROPRIO", procuracaoGrupo: null, procuracaoPosicao: null }),
    ).resolves.toEqual({ type: "PROPRIO" });
  });
});

function fakeEstablishmentsDb(initial: { locked_at: string | null }) {
  const state = { ...initial };
  return {
    state,
    from() {
      return {
        update: (values: Record<string, unknown>) => ({
          eq: () => ({
            or: (condition: string) => ({
              select: () => ({
                maybeSingle: async () => {
                  const staleBefore = condition.split("locked_at.lt.")[1];
                  const eligible = state.locked_at === null || (staleBefore !== undefined && state.locked_at < staleBefore);
                  if (!eligible) return { data: null, error: null };
                  Object.assign(state, values);
                  return { data: { id: "estab-1" }, error: null };
                },
              }),
            }),
            // releaseEstablishmentLock has no .select()/.or() after eq()
            then: (resolve: (value: unknown) => void) => {
              Object.assign(state, values);
              resolve({ data: null, error: null });
            },
          }),
        }),
      };
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient & { state: { locked_at: string | null } };
}

describe("acquireEstablishmentLock / releaseEstablishmentLock", () => {
  it("trava um estabelecimento livre", async () => {
    const db = fakeEstablishmentsDb({ locked_at: null });
    await expect(acquireEstablishmentLock(db, "estab-1", "user-1")).resolves.toBe(true);
  });
  it("não trava um estabelecimento já travado recentemente", async () => {
    const db = fakeEstablishmentsDb({ locked_at: new Date().toISOString() });
    await expect(acquireEstablishmentLock(db, "estab-1", "user-1")).resolves.toBe(false);
  });
  it("libera a trava", async () => {
    const db = fakeEstablishmentsDb({ locked_at: new Date().toISOString() });
    await releaseEstablishmentLock(db, "estab-1");
    expect(db.state.locked_at).toBeNull();
  });
});
