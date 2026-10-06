import "server-only";
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MAX_EOCD_COMMENT_SCAN = 65557; // EOCD (22 bytes) + maior comentário possível (65535 bytes)

export class UnsafeZipError extends Error {}

export type ZipEntry = { name: string; compressedSize: number; uncompressedSize: number; compressionMethod: number; localHeaderOffset: number };

function findEndOfCentralDirectory(buffer: Buffer) {
  const start = Math.max(0, buffer.length - MAX_EOCD_COMMENT_SCAN);
  for (let offset = buffer.length - 22; offset >= start; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new UnsafeZipError("Assinatura de fim de diretório central não encontrada — arquivo não é um ZIP válido.");
}

/** Lê só os metadados do diretório central (nomes e tamanhos declarados), sem descompactar nada — permite aplicar limites de segurança antes de gastar CPU/memória descompactando qualquer entrada. */
export function readZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralDirectoryOffset === 0xffffffff || totalEntries === 0xffff) throw new UnsafeZipError("ZIP64 não é suportado.");
  if (centralDirectoryOffset + centralDirectorySize > buffer.length) throw new UnsafeZipError("Diretório central do ZIP está corrompido.");

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) throw new UnsafeZipError("Registro de diretório central inválido.");
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.push({ name, compressedSize, uncompressedSize, compressionMethod, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Descompacta uma entrada lendo o header local real (a fonte de verdade para onde os dados comprimidos começam, que pode divergir do diretório central). */
export function extractZipEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== LOCAL_FILE_HEADER_SIGNATURE) throw new UnsafeZipError("Cabeçalho local do ZIP inválido.");
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw new UnsafeZipError("Dados comprimidos além do fim do arquivo.");
  const compressed = buffer.subarray(dataStart, dataEnd);
  if (entry.compressionMethod === 0) return Buffer.from(compressed);
  if (entry.compressionMethod === 8) {
    // `maxOutputLength` = tamanho declarado: um ZIP que MENTE no cabeçalho (declara pouco e infla muito)
    // para furar a checagem de zip bomb estoura aqui em vez de alocar memória sem limite.
    try {
      return inflateRawSync(compressed, { maxOutputLength: Math.max(entry.uncompressedSize, 1) });
    } catch {
      throw new UnsafeZipError("Entrada excede o tamanho descompactado declarado ou está corrompida.");
    }
  }
  throw new UnsafeZipError(`Método de compactação ${entry.compressionMethod} não suportado.`);
}
