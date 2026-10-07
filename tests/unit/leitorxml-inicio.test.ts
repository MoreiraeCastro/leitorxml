import { describe, expect, it } from "vitest";
import { filterRows, groupByCompany, nextAction, parseFilter, phaseOf, pillLabel, summarize, type TaskInput } from "@/lib/leitorxml/inicio";

const task = (establishmentId: string, razaoSocial: string, tipo: string, papel: string, status: string, id = `${establishmentId}-${tipo}-${papel}`): TaskInput => ({
  id, status, tipo_documento: tipo, papel, establishmentId, cnpj: `${establishmentId.charCodeAt(0)}000100`, razaoSocial,
});

const sample: TaskInput[] = [
  task("a", "Bueno Gourmet", "NFE", "EMITENTE", "SEM_DOCUMENTOS"),
  task("a", "Bueno Gourmet", "NFE", "DESTINATARIO", "DISPONIVEL_REVISAO"),
  task("a", "Bueno Gourmet", "NFCE", "EMITENTE", "SEM_DOCUMENTOS"),
  task("b", "Ariss", "NFE", "EMITENTE", "EXPIRADA"),
  task("b", "Ariss", "NFE", "DESTINATARIO", "AGENDADA"),
  task("b", "Ariss", "NFCE", "EMITENTE", "AGENDADA"),
  task("c", "Corujão", "NFE", "EMITENTE", "PROCESSANDO_SEFAZ"),
];

describe("fases e etiquetas", () => {
  it("agrupa os status do banco em fases que a equipe entende", () => {
    expect(phaseOf("AGENDADA")).toBe("PEDIR");
    expect(phaseOf("PROCESSANDO_SEFAZ")).toBe("SEFAZ");
    expect(phaseOf("PRONTO_PARA_BAIXAR")).toBe("PRONTA");
    expect(phaseOf("DISPONIVEL_REVISAO")).toBe("REVISAR");
    expect(phaseOf("EXPIRADA")).toBe("PROBLEMA");
  });
  it("problema diz qual é; os demais usam o rótulo da fase", () => {
    expect(pillLabel("EXPIRADA")).toBe("Expirada");
    expect(pillLabel("FALHA")).toBe("Falha");
    expect(pillLabel("SOLICITADO")).toBe("No SEFAZ");
    expect(pillLabel("SEM_DOCUMENTOS")).toBe("Sem docs");
  });
});

describe("groupByCompany / summarize", () => {
  const rows = groupByCompany(sample);
  it("uma linha por empresa, em ordem alfabética, com as 3 etiquetas nas colunas certas", () => {
    expect(rows.map((row) => row.razaoSocial)).toEqual(["Ariss", "Bueno Gourmet", "Corujão"]);
    expect(rows[1].tasks.NFE_DESTINATARIO?.phase).toBe("REVISAR");
    expect(rows[2].tasks.NFCE_EMITENTE).toBeUndefined();
  });
  it("conta tarefas por fase e empresas já recebidas (todas com resultado ou sem documentos)", () => {
    const counts = summarize(rows);
    expect(counts).toMatchObject({ PEDIR: 2, SEFAZ: 1, REVISAR: 1, SEM_DOCS: 2, PROBLEMA: 1, empresas: 3, empresasRecebidas: 1 });
  });
});

describe("filtros", () => {
  const rows = groupByCompany(sample);
  it("filtra pela fase e pela busca (nome ou CNPJ, ignorando pontuação)", () => {
    expect(filterRows(rows, "PROBLEMA").map((row) => row.razaoSocial)).toEqual(["Ariss"]);
    expect(filterRows(rows, "TUDO", "bueno")).toHaveLength(1);
    expect(filterRows(rows, "TUDO", "99.000/100")).toHaveLength(1);
  });
  it("filtro desconhecido vira TUDO", () => {
    expect(parseFilter("nada")).toBe("TUDO");
    expect(parseFilter("PRONTA")).toBe("PRONTA");
  });
});

describe("nextAction", () => {
  const base = summarize([]);
  it("sem tarefas, manda criar as do mês", () => {
    expect(nextAction(base, "setembro/2026").title).toContain("Nenhuma tarefa");
  });
  it("problema vem antes de tudo, depois prontas, depois pedir, depois revisar", () => {
    const counts = { ...base, empresas: 5, PROBLEMA: 1, PRONTA: 2, PEDIR: 3, REVISAR: 4 };
    expect(nextAction(counts, "x").title).toBe("Resolver 1 problema");
    expect(nextAction({ ...counts, PROBLEMA: 0 }, "x").title).toBe("Baixar 2 prontas");
    expect(nextAction({ ...counts, PROBLEMA: 0, PRONTA: 0 }, "x").title).toBe("Pedir 3 tarefas");
    expect(nextAction({ ...counts, PROBLEMA: 0, PRONTA: 0, PEDIR: 0 }, "x").title).toBe("Revisar 4 arquivos");
  });
  it("tudo concluído → tudo em dia", () => {
    expect(nextAction({ ...base, empresas: 3, REVISADO: 9 }, "setembro/2026").title).toBe("Tudo em dia");
  });
});
