import { describe, expect, it } from "vitest";
import { isAuthorizedInternalRequest, runLeitorXmlSweep } from "@/lib/leitorxml/sweep";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("isAuthorizedInternalRequest", () => {
  it("rejeita quando o segredo esperado não está configurado", () => {
    expect(isAuthorizedInternalRequest("qualquer-coisa", undefined)).toBe(false);
  });
  it("rejeita quando nenhum segredo foi enviado", () => {
    expect(isAuthorizedInternalRequest(null, "segredo-real")).toBe(false);
  });
  it("rejeita um segredo diferente", () => {
    expect(isAuthorizedInternalRequest("errado", "segredo-real")).toBe(false);
  });
  it("aceita quando o segredo enviado bate exatamente", () => {
    expect(isAuthorizedInternalRequest("segredo-real", "segredo-real")).toBe(true);
  });
});

function chain(result: { data?: unknown; error?: unknown; count?: number }) {
  const self: Record<string, unknown> = {
    select: () => self, eq: () => self, or: () => self, in: () => self,
    update: () => self, lt: () => self, order: () => self, limit: () => self, upsert: () => self,
    then: (resolve: (value: unknown) => void) => resolve(result),
  };
  return self;
}

function fakeDb(responses: Record<string, Array<{ data?: unknown; error?: unknown; count?: number }>>) {
  const cursors: Record<string, number> = {};
  return {
    from(table: string) {
      const queue = responses[table] ?? [];
      const index = Math.min(cursors[table] ?? 0, queue.length - 1);
      cursors[table] = (cursors[table] ?? 0) + 1;
      return chain(queue[index] ?? { data: null, error: null });
    },
  } as unknown as SupabaseClient;
}

describe("runLeitorXmlSweep", () => {
  it("não gera o lote mensal antes do dia 10", async () => {
    const db = fakeDb({ xml_collection_tasks: [{ data: [], error: null }] });
    const result = await runLeitorXmlSweep({ db, now: new Date("2026-09-05T08:00:00Z") });
    expect(result.monthlyBatch).toEqual({ ranToday: false, establishments: 0, tasksCreated: 0 });
    expect(result.escalated).toBe(0);
  });

  it("gera o lote mensal a partir do dia 10, junto com o escalonamento", async () => {
    const db = fakeDb({
      xml_collection_tasks: [{ data: [{ id: "task-1" }], error: null }, { data: null, error: null, count: 3 }],
      xml_watch_establishments: [{ data: [{ id: "estab-1", ativo: true, situacao_cadastral: "Habilitada" }], error: null }],
    });
    const result = await runLeitorXmlSweep({ db, now: new Date("2026-09-10T08:00:00Z") });
    expect(result.escalated).toBe(1);
    expect(result.monthlyBatch).toEqual({ ranToday: true, establishments: 1, tasksCreated: 3 });
  });
});
