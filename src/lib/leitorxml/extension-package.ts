import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { buildStoredZip, type ZipInput } from "./zip-writer";

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

/** A pasta `extension/` do repositório como ZIP, tudo dentro de uma pasta "LeitorXML" (extrair em C:\ cria C:\LeitorXML). */
export async function buildExtensionZip(): Promise<Buffer | null> {
  const files = await collect(path.join(process.cwd(), "extension"));
  if (!files.some((file) => file.name === "manifest.json")) return null;
  return buildStoredZip(files.map((file) => ({ ...file, name: `LeitorXML/${file.name}` })));
}
