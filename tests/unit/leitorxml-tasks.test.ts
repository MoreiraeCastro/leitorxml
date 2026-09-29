import { describe, expect, it } from "vitest";
import { createTasksForEstablishments, escalateStaleProcessing, generateMonthlyTasks, previousClosedCompetencia } from "@/lib/leitorxml/tasks";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("previousClosedCompetencia", () => {
  it("retorna o mês anterior dentro do mesmo ano", () => {
    expect(previousClosedCompetencia(new Date(Date.UTC(2026, 8, 28)))).toEqual({ competenciaAno: 2026, competenciaMes: 8 });
  });
  it("volta para dezembro do ano anterior em janeiro", () => {
    expect(previousClosedCompetencia(new Date(Date.UTC(2026, 0, 15)))).toEqual({ competenciaAno: 2025, competenciaMes: 12 });
  });
});

/** Thenable encadeável: cada método de query devolve `this`, e o objeto resolve como uma promise a partir de `result` a qualquer ponto da cadeia em que for `await`ado — do mesmo jeito que o query builder real do supabase-js funciona. */
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

describe("generateMonthlyTasks", () => {
  it("cria 3 tarefas por estabelecimento elegível", async () => {
    const db = fakeDb({
      xml_watch_establishments: [{ data: [{ id: "estab-1", ativo: true, situacao_cadastral: "Habilitada" }, { id: "estab-2", ativo: true, situacao_cadastral: null }], error: null }],
      xml_collection_tasks: [{ data: null, error: null, count: 6 }],
    });
    const result = await generateMonthlyTasks(db, { competenciaAno: 2026, competenciaMes: 8 });
    expect(result).toEqual({ establishments: 2, tasksCreated: 6 });
  });

  it("não gera tarefas quando não há estabelecimentos elegíveis", async () => {
    const db = fakeDb({ xml_watch_establishments: [{ data: [], error: null }] });
    const result = await generateMonthlyTasks(db, { competenciaAno: 2026, competenciaMes: 8 });
    expect(result).toEqual({ establishments: 0, tasksCreated: 0 });
  });

  it("propaga falha na consulta de estabelecimentos", async () => {
    const db = fakeDb({ xml_watch_establishments: [{ data: null, error: { message: "db down" } }] });
    await expect(generateMonthlyTasks(db, { competenciaAno: 2026, competenciaMes: 8 })).rejects.toThrow("ESTABLISHMENTS_LOOKUP_FAILED");
  });
});

describe("createTasksForEstablishments", () => {
  it("ignora estabelecimentos baixados/inativos na contagem de elegíveis", async () => {
    const db = fakeDb({
      xml_watch_establishments: [
        { data: [{ id: "estab-1", ativo: true, situacao_cadastral: "Habilitada" }, { id: "estab-2", ativo: true, situacao_cadastral: "Baixada" }], error: null },
      ],
      xml_collection_tasks: [{ data: null, error: null, count: 3 }],
    });
    const result = await createTasksForEstablishments(db, { establishmentIds: ["estab-1", "estab-2"], competenciaAno: 2026, competenciaMes: 8 });
    expect(result).toEqual({ establishments: 1, tasksCreated: 3, skipped: 1 });
  });
});

describe("escalateStaleProcessing", () => {
  it("conta as tarefas escalonadas para intervenção manual", async () => {
    const db = fakeDb({ xml_collection_tasks: [{ data: [{ id: "task-1" }, { id: "task-2" }], error: null }] });
    await expect(escalateStaleProcessing(db, { now: new Date("2026-09-28T12:00:00Z") })).resolves.toEqual({ escalated: 2 });
  });

  it("propaga falha na atualização", async () => {
    const db = fakeDb({ xml_collection_tasks: [{ data: null, error: { message: "db down" } }] });
    await expect(escalateStaleProcessing(db)).rejects.toThrow("STALE_TASKS_ESCALATION_FAILED");
  });
});
