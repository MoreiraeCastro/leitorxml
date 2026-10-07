import { describe, expect, it } from "vitest";
import { toDeliveryItems } from "@/lib/leitorxml/entregas";

const row = (establishment: unknown) => ({ id: "t1", tipo_documento: "NFE", papel: "EMITENTE", competencia_ano: 2026, competencia_mes: 9, xml_watch_establishments: establishment as never });

describe("toDeliveryItems", () => {
  it("monta o caminho CNPJ - Razão/AAAA-MM/arquivo.zip", () => {
    const [item] = toDeliveryItems([row({ cnpj: "12345678000190", razao_social: "Empresa Teste", sharepoint_folder_path: null })]);
    expect(item.taskId).toBe("t1");
    expect(item.path).toMatch(/^12345678000190 - Empresa Teste\/2026-09\/.+\.zip$/);
  });

  it("aceita a empresa como lista e ignora tarefa sem empresa", () => {
    const items = toDeliveryItems([
      row([{ cnpj: "12345678000190", razao_social: "Empresa Teste", sharepoint_folder_path: null }]),
      row(null),
    ]);
    expect(items).toHaveLength(1);
  });
});
