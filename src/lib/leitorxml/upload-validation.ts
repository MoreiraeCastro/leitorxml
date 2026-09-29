import "server-only";
import { createHash } from "node:crypto";
import { readZipEntries, extractZipEntry, UnsafeZipError, type ZipEntry } from "./zip";

export const MAX_ZIP_ENTRIES = 2000;
export const MAX_ENTRY_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50MB por XML individual
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024; // 500MB no total do lote
// Lookaround só em dígitos (não \b): a chave de acesso normalmente aparece
// colada a letras sem separador, ex. Id="NFe35260900...0010" no XML autorizado.
const ACCESS_KEY_PATTERN = /(?<!\d)\d{44}(?!\d)/g;

export type UploadValidationResult = {
  ok: boolean;
  reason?: string;
  hashSha256: string;
  totalBytes: number;
  entryCount: number;
  accessKeysFound: string[];
};

function assertSafeEntry(entry: ZipEntry) {
  if (entry.name.includes("..") || entry.name.startsWith("/") || entry.name.startsWith("\\")) {
    throw new UnsafeZipError(`Nome de entrada inseguro no ZIP: ${entry.name}`);
  }
  if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
    throw new UnsafeZipError(`Entrada "${entry.name}" excede o limite individual de tamanho descompactado.`);
  }
}

/**
 * Validação estrutural do ZIP baixado do Fisco Fácil: descompactação segura
 * (guarda contra zip bomb — limites de entradas/tamanho aplicados sobre os
 * metadados declarados ANTES de descompactar qualquer coisa), hash para
 * dedup, e presença de chave de acesso (44 dígitos) nos XMLs contidos.
 * Validação de negócio mais fina (CNPJ/modelo/período batendo com a tarefa)
 * fica para uma iteração seguinte, com XMLs reais de amostra para testar.
 */
export function validateCollectedZip(buffer: Buffer): UploadValidationResult {
  const hashSha256 = createHash("sha256").update(buffer).digest("hex");
  const totalBytes = buffer.length;
  try {
    const entries = readZipEntries(buffer).filter((entry) => !entry.name.endsWith("/"));
    if (entries.length === 0) return { ok: false, reason: "ZIP_VAZIO", hashSha256, totalBytes, entryCount: 0, accessKeysFound: [] };
    if (entries.length > MAX_ZIP_ENTRIES) return { ok: false, reason: "ZIP_EXCEDE_LIMITE_ENTRADAS", hashSha256, totalBytes, entryCount: entries.length, accessKeysFound: [] };
    const totalUncompressed = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) return { ok: false, reason: "ZIP_EXCEDE_LIMITE_TAMANHO", hashSha256, totalBytes, entryCount: entries.length, accessKeysFound: [] };
    entries.forEach(assertSafeEntry);

    const accessKeys = new Set<string>();
    for (const entry of entries) {
      const content = extractZipEntry(buffer, entry).toString("utf8");
      for (const match of content.matchAll(ACCESS_KEY_PATTERN)) accessKeys.add(match[0]);
    }
    return { ok: true, hashSha256, totalBytes, entryCount: entries.length, accessKeysFound: [...accessKeys] };
  } catch (error) {
    if (error instanceof UnsafeZipError) return { ok: false, reason: error.message, hashSha256, totalBytes, entryCount: 0, accessKeysFound: [] };
    throw error;
  }
}
