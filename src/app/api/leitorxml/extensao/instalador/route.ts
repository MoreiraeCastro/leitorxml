import { NextResponse } from "next/server";
import { requireOfficeSession } from "@/lib/auth/session";
import { buildExtensionZip } from "@/lib/leitorxml/extension-package";
import { buildInstallerBat } from "@/lib/leitorxml/instalador";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Instalador de 1 clique (.bat com a extensão embutida): extrai em C:\LeitorXML e abre o Chrome na página de extensões. */
export async function GET() {
  try { await requireOfficeSession(); } catch { return NextResponse.json({ error: "Acesso do escritório necessário." }, { status: 403 }); }
  const zip = await buildExtensionZip();
  if (!zip) return NextResponse.json({ error: "Extensão indisponível neste servidor." }, { status: 500 });
  return new NextResponse(new Uint8Array(buildInstallerBat(zip)), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="instalar-leitor-de-xml.bat"',
      "Cache-Control": "no-store",
    },
  });
}
