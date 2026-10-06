import "server-only";
import { createHash } from "node:crypto";
import { readZipEntries, extractZipEntry, UnsafeZipError, type ZipEntry } from "./zip";

/** Por arquivo ZIP (cada nível). Um dia de NFC-e de um restaurante movimentado passa fácil de 2000 notas. */
export const MAX_ZIP_ENTRIES = 20000;
/** Soma de entradas de TODOS os níveis aninhados. */
export const MAX_TREE_ENTRIES = 200000;
/**
 * O ZIP do Fisco Fácil vem aninhado em 3 níveis (confirmado ao vivo, 2026-10-06): o arquivo baixado traz
 * `AAAA_MM.zip`, que traz um ZIP por dia (`03.zip`, `04.zip`...), que traz os XMLs. Profundidade 0 = o
 * arquivo baixado; o limite permite até 3 níveis de ZIP dentro dele.
 */
export const MAX_ZIP_DEPTH = 4;
export const MAX_ENTRY_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50MB por XML individual
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024; // 500MB no total do lote (somando todos os níveis)
// Lookaround só em dígitos (não \b): a chave de acesso normalmente aparece
// colada a letras sem separador, ex. Id="NFe35260900...0010" no XML autorizado
// ou no próprio nome do arquivo (NFE33260831088032000114550010000190881632500008.xml).
const ACCESS_KEY_PATTERN = /(?<!\d)\d{44}(?!\d)/g;
const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;

export type UploadValidationResult = {
  ok: boolean;
  reason?: string;
  hashSha256: string;
  totalBytes: number;
  /** Quantidade de arquivos "folha" (XMLs) em todos os níveis — os ZIPs aninhados não contam. */
  entryCount: number;
  accessKeysFound: string[];
};

type Totals = { entries: number; bytes: number; leafFiles: number; keys: Set<string> };

function assertSafeEntry(entry: ZipEntry) {
  if (entry.name.includes("..") || entry.name.startsWith("/") || entry.name.startsWith("\\")) {
    throw new UnsafeZipError(`Nome de entrada inseguro no ZIP: ${entry.name}`);
  }
  if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
    throw new UnsafeZipError(`Entrada "${entry.name}" excede o limite individual de tamanho descompactado.`);
  }
}

function isZip(buffer: Buffer) {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === ZIP_LOCAL_HEADER_SIGNATURE;
}

/**
 * Percorre um ZIP e, recursivamente, os ZIPs dentro dele. Os limites de segurança (entradas, tamanho) são
 * aplicados sobre os metadados declarados de cada nível ANTES de descompactar, e acumulados em `totals`
 * para valer na árvore inteira — um ZIP aninhado não pode contornar o limite de um nível só.
 */
function scanArchive(buffer: Buffer, depth: number, totals: Totals) {
  const entries = readZipEntries(buffer).filter((entry) => !entry.name.endsWith("/"));
  if (depth === 0 && entries.length === 0) throw new UnsafeZipError("ZIP_VAZIO");
  if (entries.length > MAX_ZIP_ENTRIES) throw new UnsafeZipError("ZIP_EXCEDE_LIMITE_ENTRADAS");
  totals.entries += entries.length;
  if (totals.entries > MAX_TREE_ENTRIES) throw new UnsafeZipError("ZIP_EXCEDE_LIMITE_ENTRADAS");
  totals.bytes += entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (totals.bytes > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new UnsafeZipError("ZIP_EXCEDE_LIMITE_TAMANHO");
  entries.forEach(assertSafeEntry);

  for (const entry of entries) {
    const content = extractZipEntry(buffer, entry);
    if (isZip(content)) {
      if (depth + 1 >= MAX_ZIP_DEPTH) throw new UnsafeZipError("ZIP_ANINHADO_PROFUNDO_DEMAIS");
      scanArchive(content, depth + 1, totals);
      continue;
    }
    totals.leafFiles += 1;
    for (const match of `${entry.name}\n${content.toString("utf8")}`.matchAll(ACCESS_KEY_PATTERN)) totals.keys.add(match[0]);
  }
}

/**
 * Validação estrutural do ZIP baixado do Fisco Fácil: descompactação segura
 * (guarda contra zip bomb — limites de entradas/tamanho aplicados sobre os
 * metadados declarados ANTES de descompactar qualquer coisa, somados em todos
 * os níveis de ZIP aninhado), hash para dedup, e presença de chave de acesso
 * (44 dígitos) nos XMLs contidos (no conteúdo ou no nome do arquivo).
 * Validação de negócio mais fina (CNPJ/modelo/período batendo com a tarefa)
 * fica para uma iteração seguinte.
 */
export function validateCollectedZip(buffer: Buffer): UploadValidationResult {
  const hashSha256 = createHash("sha256").update(buffer).digest("hex");
  const totalBytes = buffer.length;
  const totals: Totals = { entries: 0, bytes: 0, leafFiles: 0, keys: new Set() };
  try {
    scanArchive(buffer, 0, totals);
    return { ok: true, hashSha256, totalBytes, entryCount: totals.leafFiles, accessKeysFound: [...totals.keys] };
  } catch (error) {
    if (error instanceof UnsafeZipError) return { ok: false, reason: error.message, hashSha256, totalBytes, entryCount: 0, accessKeysFound: [] };
    throw error;
  }
}
