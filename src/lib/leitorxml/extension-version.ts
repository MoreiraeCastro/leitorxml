import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

let cached: string | null = null;

/** Versão da extensão que este servidor distribui (a pasta `extension/` do deploy) — é a mínima aceita para pegar trabalho. */
export async function currentExtensionVersion() {
  if (cached) return cached;
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), "extension", "manifest.json"), "utf8")) as { version: string };
  cached = manifest.version;
  return cached;
}

/** -1 / 0 / 1 comparando "0.1.10" com "0.1.9" numericamente, parte a parte. */
export function compareVersions(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Recusa pegar tarefa/empresa com extensão mais velha que a distribuída: em 13/10/2026 um PC seguiu rodando a 0.1.2
 * depois do deploy da correção, sem ninguém perceber, e queimou pedidos com o comportamento antigo. Devolve a resposta
 * 426 pronta, ou null se a versão está em dia.
 */
export async function rejectOutdatedExtension(request: Request) {
  const sent = request.headers.get("x-leitor-versao")?.trim() ?? "";
  const expected = await currentExtensionVersion().catch(() => null);
  if (!expected) return null;
  if (/^\d+(\.\d+)*$/.test(sent) && compareVersions(sent, expected) >= 0) return null;
  return NextResponse.json(
    { error: "EXTENSAO_DESATUALIZADA", instalada: sent || "desconhecida", esperada: expected },
    { status: 426 },
  );
}
