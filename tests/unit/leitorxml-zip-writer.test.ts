import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("buildStoredZip", () => {
  it("gera um ZIP que o leitor do projeto consegue abrir, com nomes e conteúdos intactos", async () => {
    const { buildStoredZip } = await import("@/lib/leitorxml/zip-writer");
    const { readZipEntries, extractZipEntry } = await import("@/lib/leitorxml/zip");
    const zip = buildStoredZip([
      { name: "manifest.json", data: Buffer.from('{"a":1}') },
      { name: "src/background.js", data: Buffer.from("console.log('olá');") },
    ]);
    const entries = readZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(["manifest.json", "src/background.js"]);
    expect(extractZipEntry(zip, entries[1]).toString("utf8")).toBe("console.log('olá');");
  });
});
