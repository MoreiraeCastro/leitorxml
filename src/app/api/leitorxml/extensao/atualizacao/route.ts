import { NextResponse } from "next/server";
import { buildExtensionZip } from "@/lib/leitorxml/extension-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pacote da extensão para o atualizador dos PCs. Público, porque o atualizador roda sem login no portal — e seguro
 * assim porque o atualizador só instala o pacote se ele bater com a assinatura (rota `assinatura`), feita com uma
 * chave privada que não fica no servidor. Mesmo conteúdo do instalador: só o código da extensão, sem token nem segredo.
 */
export async function GET() {
  const zip = await buildExtensionZip();
  if (!zip) return NextResponse.json({ error: "Extensão indisponível neste servidor." }, { status: 500 });
  return new NextResponse(new Uint8Array(zip), { headers: { "Content-Type": "application/zip", "Cache-Control": "no-store" } });
}
