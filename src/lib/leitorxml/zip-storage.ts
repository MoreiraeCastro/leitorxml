import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ZIPs do Fisco em staging, inclusive os maiores que o teto do Supabase Storage (50 MB por objeto — confirmado em
 * 15/10/2026: 55 MB → 413). NFC-e de restaurante passa disso, então ZIP grande é guardado EM PARTES: a extensão envia
 * pedaços de até PART_BYTES (cada um vira um objeto `<base>.parte-001`, `-002`…) e `storage_path_zip` passa a ser
 * `partes:<N>:<base>`. Quem lê o ZIP (pasta do PC, botão Baixar do portal, SharePoint) recebe o arquivo remontado.
 */
export const ZIP_BUCKET = "leitorxml-staging";
export const PART_BYTES = 40 * 1024 * 1024;
export const MAX_PARTS = 25; // 1 GB — muito acima do maior ZIP visto

const PARTITIONED = /^partes:(\d+):(.+)$/;

export function parsePartitioned(path: string): { total: number; base: string } | null {
  const match = PARTITIONED.exec(path);
  return match ? { total: Number(match[1]), base: match[2] } : null;
}

export function partitionedPath(base: string, total: number) {
  return `partes:${total}:${base}`;
}

export function partObjectPath(base: string, index: number) {
  return `${base}.parte-${String(index + 1).padStart(3, "0")}`;
}

/** Todos os objetos do Storage que formam o ZIP (1 para ZIP normal, N para ZIP em partes). */
export function zipObjectPaths(path: string) {
  const partitioned = parsePartitioned(path);
  return partitioned ? Array.from({ length: partitioned.total }, (_, i) => partObjectPath(partitioned.base, i)) : [path];
}

export async function removeZip(db: SupabaseClient, path: string) {
  await db.storage.from(ZIP_BUCKET).remove(zipObjectPaths(path));
}

/** ZIP inteiro em memória (remonta as partes na ordem). */
export async function readZip(db: SupabaseClient, path: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for (const objectPath of zipObjectPaths(path)) {
    const { data, error } = await db.storage.from(ZIP_BUCKET).download(objectPath);
    if (error || !data) throw new Error(`ZIP_PARTE_ILEGIVEL: ${objectPath}`);
    chunks.push(Buffer.from(await data.arrayBuffer()));
  }
  return Buffer.concat(chunks);
}

/** Resposta HTTP que entrega o ZIP remontado em fluxo (sem carregar tudo na memória). */
export async function zipResponse(db: SupabaseClient, path: string, downloadName?: string): Promise<Response> {
  const objectPaths = zipObjectPaths(path);
  const signed: string[] = [];
  for (const objectPath of objectPaths) {
    const { data, error } = await db.storage.from(ZIP_BUCKET).createSignedUrl(objectPath, 600);
    if (error || !data?.signedUrl) throw new Error(`ZIP_PARTE_SEM_LINK: ${objectPath}`);
    signed.push(data.signedUrl);
  }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const url of signed) {
          const response = await fetch(url);
          if (!response.ok || !response.body) throw new Error(`ZIP_PARTE_HTTP_${response.status}`);
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  const headers = new Headers({ "Content-Type": "application/zip", "Cache-Control": "no-store" });
  if (downloadName) headers.set("Content-Disposition", `attachment; filename="${downloadName.replace(/"/g, "")}"`);
  return new Response(stream, { headers });
}

// Link temporário para o conteúdo remontado — a extensão salva com chrome.downloads, que não manda o token Bearer.
function linkKey() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY ausente");
  return createHash("sha256").update(`leitorxml-zip-link:${secret}`).digest();
}

export function signZipLink(taskId: string, expiresAt: number) {
  return createHmac("sha256", linkKey()).update(`${taskId}.${expiresAt}`).digest("hex");
}

export function verifyZipLink(taskId: string, expiresAt: number, signature: string) {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signZipLink(taskId, expiresAt), "hex"), Buffer.from(signature, "hex"));
}
