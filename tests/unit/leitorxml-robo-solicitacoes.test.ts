import { describe, expect, it } from "vitest";
import { assertLooksLikeZip, classifySituacao, expectedPeriod, interpretRow, pickRowForTask, type TrackedTask } from "../../robo/src/solicitacoes";

const task = (patch: Partial<TrackedTask> = {}): TrackedTask => ({
  id: "t1", tipoDocumento: "NFE", papel: "DESTINATARIO", competenciaAno: 2026, competenciaMes: 8, status: "SOLICITADO", sefazReferencia: null, ...patch,
});
const raw = (referencia: string, quandoTexto = "06/10/2026 10:54:49", situacaoTexto = "Processada", index = 0) => ({ index, referencia, quandoTexto, situacaoTexto, temLink: true });

describe("interpretRow", () => {
  it("lê documento, participante, período e data/hora da referência da tela", () => {
    const row = interpretRow(raw("NF-e - Destinatário - Período: 01/08/2026 a 31/08/2026"));
    expect(row).toMatchObject({ tipoDocumento: "NFE", papel: "DESTINATARIO", periodoInicio: "01/08/2026", periodoFim: "31/08/2026" });
    expect(new Date(row.quando).getHours()).toBe(10);
  });

  it("NFC-e não é confundida com NF-e, e sem papel/período vira null", () => {
    expect(interpretRow(raw("NFC-e - Emitente - Período: 01/08/2026 a 31/08/2026")).tipoDocumento).toBe("NFCE");
    const vazio = interpretRow(raw("outra coisa"));
    expect(vazio).toMatchObject({ tipoDocumento: null, papel: null, periodoInicio: null });
  });
});

describe("expectedPeriod", () => {
  it("cobre o mês inteiro, inclusive fevereiro de ano bissexto", () => {
    expect(expectedPeriod({ competenciaAno: 2026, competenciaMes: 8 })).toEqual({ inicio: "01/08/2026", fim: "31/08/2026" });
    expect(expectedPeriod({ competenciaAno: 2028, competenciaMes: 2 })).toEqual({ inicio: "01/02/2028", fim: "29/02/2028" });
  });
});

describe("pickRowForTask", () => {
  const rows = [
    interpretRow(raw("NFC-e - Emitente - Período: 01/08/2026 a 31/08/2026", "10/09/2026 09:24:43", "Expirada", 0)),
    interpretRow(raw("NF-e - Destinatário - Período: 01/08/2026 a 31/08/2026", "06/10/2026 10:54:49", "Processada", 1)),
    interpretRow(raw("NF-e - Destinatário - Período: 01/08/2026 a 31/08/2026", "10/09/2026 09:24:35", "Processada sem resultado", 2)),
    interpretRow(raw("NF-e - Destinatário - Período: 01/07/2026 a 31/07/2026", "06/10/2026 11:00:00", "Processada", 3)),
  ];

  it("escolhe a linha do mesmo documento, participante e mês — a mais recente", () => {
    expect(pickRowForTask(rows, task())?.index).toBe(1);
  });

  it("não pega outro mês nem outro documento", () => {
    expect(pickRowForTask(rows, task({ competenciaMes: 7 }))?.index).toBe(3);
    expect(pickRowForTask(rows, task({ tipoDocumento: "NFE", papel: "EMITENTE" }))).toBeNull();
  });
});

describe("classifySituacao", () => {
  it.each([
    ["Aguardando processamento", "PROCESSANDO_SEFAZ"],
    ["Expirada", "EXPIRADA"],
    ["Processada sem resultado", "SEM_DOCUMENTOS"],
    ["Processada", "PRONTO_PARA_BAIXAR"],
    ["Processada com resultado", "PRONTO_PARA_BAIXAR"],
    ["Cancelada pelo contribuinte", "DESCONHECIDA"],
  ])("%s -> %s", (texto, esperado) => {
    expect(classifySituacao(texto)).toBe(esperado);
  });
});

describe("assertLooksLikeZip", () => {
  it("aceita assinatura PK e recusa resposta que não é ZIP, mostrando o começo dela", () => {
    expect(() => assertLooksLikeZip(new Uint8Array([0x50, 0x4b, 3, 4]))).not.toThrow();
    expect(() => assertLooksLikeZip(new TextEncoder().encode("<html>erro</html>"))).toThrow(/RESPOSTA_NAO_E_ZIP.*<html>erro/);
  });
});
