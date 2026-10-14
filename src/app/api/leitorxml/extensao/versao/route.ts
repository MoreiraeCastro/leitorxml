import { NextResponse } from "next/server";
import { currentExtensionVersion } from "@/lib/leitorxml/extension-version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Versão da extensão distribuída por este servidor. Pública: consultada pela tarefa de atualização do Windows (sem login) e pela própria extensão. */
export async function GET() {
  try {
    return NextResponse.json({ version: await currentExtensionVersion() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Versão indisponível." }, { status: 500 });
  }
}
