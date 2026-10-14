import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Assinatura da versão publicada da extensão (gerada fora do servidor por scripts/assinar-extensao.mjs). Pública: o
 * atualizador dos PCs confere o pacote baixado contra ela com a chave pública embutida — a chave privada nunca passa
 * por aqui, então servir este arquivo não dá a ninguém o poder de assinar.
 */
export async function GET() {
  try {
    const json = await readFile(path.join(process.cwd(), "extension-assinatura", "assinatura.json"), "utf8");
    return new NextResponse(json, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Nenhuma versão assinada publicada." }, { status: 404 });
  }
}
