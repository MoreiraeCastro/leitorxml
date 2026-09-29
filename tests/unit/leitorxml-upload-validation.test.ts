import { describe, expect, it } from "vitest";
import { MAX_TOTAL_UNCOMPRESSED_BYTES, MAX_ZIP_ENTRIES, validateCollectedZip } from "@/lib/leitorxml/upload-validation";

/**
 * Escreve um ZIP mínimo, método "store" (sem compactação) — suficiente para
 * exercitar o leitor sem depender de deflate. CRC-32 é escrito como 0: o
 * leitor de zip.ts não o valida. `declaredUncompressedSize` permite mentir no
 * cabeçalho (tamanho descompactado bem maior que o conteúdo real) para testar
 * a guarda de zip bomb sem precisar gerar dados reais gigantes.
 */
function buildStoreZip(entries: Array<{ name: string; content: string; declaredUncompressedSize?: number }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const contentBuffer = Buffer.from(entry.content, "utf8");
    const uncompressedSize = entry.declaredUncompressedSize ?? contentBuffer.length;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // method: store
    localHeader.writeUInt16LE(0, 10); // time
    localHeader.writeUInt16LE(0, 12); // date
    localHeader.writeUInt32LE(0, 14); // crc-32
    localHeader.writeUInt32LE(contentBuffer.length, 18); // compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22); // uncompressed size (pode divergir do conteúdo real, de propósito)
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length
    localParts.push(localHeader, nameBuffer, contentBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // method: store
    centralHeader.writeUInt16LE(0, 12); // time
    centralHeader.writeUInt16LE(0, 14); // date
    centralHeader.writeUInt32LE(0, 16); // crc-32
    centralHeader.writeUInt32LE(contentBuffer.length, 20); // compressed size
    centralHeader.writeUInt32LE(uncompressedSize, 24); // uncompressed size
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + contentBuffer.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(centralDirectoryOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

describe("validateCollectedZip", () => {
  it("aceita um zip com XML contendo chave de acesso e marca OK", () => {
    const zip = buildStoreZip([{ name: "35260900000000000000550010000000011000000010.xml", content: '<NFe><infNFe Id="NFe35260900000000000000550010000000011000000010"></infNFe></NFe>' }]);
    const result = validateCollectedZip(zip);
    expect(result.ok).toBe(true);
    expect(result.entryCount).toBe(1);
    expect(result.accessKeysFound).toEqual(["35260900000000000000550010000000011000000010"]);
  });

  it("aceita um zip válido sem chave de acesso reconhecível, mas sem marcar como pronto para revisão automática", () => {
    const zip = buildStoreZip([{ name: "vazio.xml", content: "<NFe></NFe>" }]);
    const result = validateCollectedZip(zip);
    expect(result.ok).toBe(true);
    expect(result.accessKeysFound).toEqual([]);
  });

  it("rejeita um zip sem nenhuma entrada de arquivo", () => {
    const zip = buildStoreZip([]);
    const result = validateCollectedZip(zip);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("ZIP_VAZIO");
  });

  it("rejeita nomes de entrada com path traversal", () => {
    const zip = buildStoreZip([{ name: "../../etc/passwd", content: "x" }]);
    const result = validateCollectedZip(zip);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("inseguro");
  });

  it("rejeita um buffer que não é um zip válido", () => {
    const result = validateCollectedZip(Buffer.from("isto não é um zip"));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("não é um ZIP válido");
  });

  it("rejeita um zip cujo tamanho descompactado declarado excede o limite (guarda de zip bomb)", () => {
    const zip = buildStoreZip([{ name: "bomba.xml", content: "x", declaredUncompressedSize: MAX_TOTAL_UNCOMPRESSED_BYTES + 1 }]);
    const result = validateCollectedZip(zip);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("ZIP_EXCEDE_LIMITE_TAMANHO");
  });

  it("rejeita um zip com mais entradas do que o limite permitido", () => {
    const entries = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, index) => ({ name: `doc-${index}.xml`, content: "x" }));
    const zip = buildStoreZip(entries);
    const result = validateCollectedZip(zip);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("ZIP_EXCEDE_LIMITE_ENTRADAS");
  });

  it("calcula o hash sha256 de forma estável para o mesmo conteúdo", () => {
    const zip = buildStoreZip([{ name: "a.xml", content: "conteudo" }]);
    expect(validateCollectedZip(zip).hashSha256).toEqual(validateCollectedZip(Buffer.from(zip)).hashSha256);
  });
});
