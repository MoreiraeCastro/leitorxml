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

describe("resolveAccessContext", () => {
  it("resolve procuração quando o grupo está presente", () => {
    expect(resolveAccessContext({ certificadoTipo: "ESCRITORIO_PROCURACAO", procuracaoGrupo: "SUBFIN", procuracaoPosicao: 5 })).toEqual({
      type: "PROCURACAO",
      grupo: "SUBFIN",
      posicao: 5,
    });
  });
  it("lança erro quando o tipo é procuração mas falta o grupo", () => {
    expect(() => resolveAccessContext({ certificadoTipo: "ESCRITORIO_PROCURACAO", procuracaoGrupo: null, procuracaoPosicao: null })).toThrow("PROCURACAO_GRUPO_AUSENTE");
  });
  it("resolve certificado próprio", () => {
    expect(resolveAccessContext({ certificadoTipo: "PROPRIO", procuracaoGrupo: null, procuracaoPosicao: null })).toEqual({ type: "PROPRIO" });
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
