import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireOfficeSession } from "@/lib/auth/session";
import { buildStoredZip, type ZipInput } from "@/lib/leitorxml/zip-writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function collect(dir: string, prefix = ""): Promise<ZipInput[]> {
  const out: ZipInput[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) out.push(...await collect(full, `${name}/`));
    else if (entry.name !== "README.md") out.push({ name, data: await readFile(full) });
  }
  return out;
}

/** Entrega a extensão pronta (pasta `extension/` do repositório) como ZIP, para instalar em outro computador sem Git nem Node. */
export async function GET() {
  try { await requireOfficeSession(); } catch { return NextResponse.json({ error: "Acesso do escritório necessário." }, { status: 403 }); }
  const root = path.join(process.cwd(), "extension");
  const files = await collect(root);
  if (!files.some((file) => file.name === "manifest.json")) return NextResponse.json({ error: "Extensão indisponível neste servidor." }, { status: 500 });
  const zip = buildStoredZip(files);
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="leitor-de-xml-extensao.zip"',
      "Cache-Control": "no-store",
    },
  });
}
