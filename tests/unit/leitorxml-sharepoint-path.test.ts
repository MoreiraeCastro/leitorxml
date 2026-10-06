import { describe, expect, it } from "vitest";
import { buildSharePointPath, safeSegment } from "@/lib/leitorxml/sharepoint";

const base = { cnpj: "31088032000114", razaoSocial: "KNK Osanai Ltda.", tipo: "NFE", papel: "DESTINATARIO", ano: 2026, mes: 8 };

describe("buildSharePointPath", () => {
  it("sem pasta cadastrada, usa 'CNPJ - Razão Social' / AAAA-MM / arquivo", () => {
    expect(buildSharePointPath({ ...base, folderPath: null })).toEqual({
      directory: ["31088032000114 - KNK Osanai Ltda", "2026-08"],
      filename: "31088032000114_NFE_DESTINATARIO_2026-08.zip",
    });
  });

  it("com pasta cadastrada, usa cada trecho do caminho (barra normal ou invertida)", () => {
    const result = buildSharePointPath({ ...base, folderPath: "Fisco Fácil\\Clientes/KNK" });
    expect(result.directory).toEqual(["Fisco Fácil", "Clientes", "KNK", "2026-08"]);
  });

  it("neutraliza caracteres que o SharePoint não aceita e não deixa subir de pasta", () => {
    expect(safeSegment('A/B:C*D?"E<F>G|H#I%J')).toBe("A-B-C-D--E-F-G-H-I-J");
    expect(buildSharePointPath({ ...base, folderPath: "../../fora" }).directory).toEqual(["sem-nome", "sem-nome", "fora", "2026-08"]);
  });

  it("não termina nome em ponto ou espaço", () => {
    expect(safeSegment("Empresa S.A. ")).toBe("Empresa S.A");
  });
});
