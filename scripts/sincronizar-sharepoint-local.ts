/**
 * Ponte local enquanto o envio direto ao SharePoint (Microsoft Graph) não tem aprovação do administrador:
 * copia os ZIPs validados do staging (Supabase Storage) para uma pasta SINCRONIZADA do SharePoint no PC,
 * com a mesma estrutura do envio direto (<empresa>/<AAAA-MM>/<arquivo>.zip). O cliente do OneDrive sobe pra nuvem.
 *
 *   node scripts/sincronizar-sharepoint-local.ts --dest "C:\...\arquivos - Documentos\Tecnologia\Leitor de XML - Zips" [--dry-run]
 *
 * Usa as chaves do .env.local. Só pega tarefas em revisão com ZIP em staging e sem `sharepoint_path`; depois de
 * copiar, grava `sharepoint_path` na tarefa. Rodar de novo é seguro (idempotente).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildSharePointPath } from "../src/lib/leitorxml/sharepoint-path.ts";

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadEnv() {
  const env: Record<string, string> = {};
  for (const line of readFileSync(resolve(import.meta.dirname, "../.env.local"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  return env;
}

const dest = arg("dest");
const dryRun = process.argv.includes("--dry-run");
if (!dest || !existsSync(dest)) {
  console.error('Informe --dest com uma pasta existente (a pasta sincronizada do SharePoint). Ex.: --dest "C:\\...\\Tecnologia\\Leitor de XML - Zips"');
  process.exit(1);
}

const env = loadEnv();
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
if (!env.NEXT_PUBLIC_SUPABASE_URL || !key) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / chave de serviço no .env.local.");
  process.exit(1);
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, key);

type Establishment = { cnpj: string; razao_social: string; sharepoint_folder_path: string | null };
const { data, error } = await db
  .from("xml_collection_tasks")
  .select("id,storage_path_zip,tipo_documento,papel,competencia_ano,competencia_mes,xml_watch_establishments(cnpj,razao_social,sharepoint_folder_path)")
  .in("status", ["DISPONIVEL_REVISAO", "REVISADO"])
  .is("sharepoint_path", null)
  .not("storage_path_zip", "is", null);
if (error) throw error;

let copied = 0;
let failed = 0;
for (const task of data ?? []) {
  const raw = task.xml_watch_establishments as Establishment | Establishment[] | null;
  const establishment = Array.isArray(raw) ? raw[0] : raw;
  if (!establishment) {
    console.error(`! ${task.id}: estabelecimento não encontrado`);
    failed += 1;
    continue;
  }
  const { directory, filename } = buildSharePointPath({
    cnpj: establishment.cnpj, razaoSocial: establishment.razao_social, folderPath: establishment.sharepoint_folder_path,
    tipo: task.tipo_documento, papel: task.papel, ano: task.competencia_ano, mes: task.competencia_mes,
  });
  const relative = [...directory, filename].join("/");
  if (dryRun) {
    console.log(`(simulação) ${relative}`);
    continue;
  }
  const download = await db.storage.from("leitorxml-staging").download(task.storage_path_zip as string);
  if (download.error || !download.data) {
    console.error(`! ${relative}: não foi possível ler o staging`);
    failed += 1;
    continue;
  }
  const buffer = Buffer.from(await download.data.arrayBuffer());
  const folder = join(dest, ...directory);
  mkdirSync(folder, { recursive: true });
  const target = join(folder, filename);
  writeFileSync(target, buffer);
  // Confere o que ficou no disco antes de marcar como entregue.
  const onDisk = createHash("sha256").update(readFileSync(target)).digest("hex");
  if (onDisk !== createHash("sha256").update(buffer).digest("hex")) {
    console.error(`! ${relative}: o arquivo gravado não confere com o original`);
    failed += 1;
    continue;
  }
  const { error: updateError } = await db.from("xml_collection_tasks").update({ sharepoint_path: `local: ${relative}`, updated_at: new Date().toISOString() }).eq("id", task.id);
  if (updateError) {
    console.error(`! ${relative}: copiado, mas não consegui registrar no banco (${updateError.message})`);
    failed += 1;
    continue;
  }
  console.log(`ok ${relative}`);
  copied += 1;
}
console.log(`\n${copied} copiado(s), ${failed} com erro, ${(data ?? []).length} pendente(s) encontrado(s).${dryRun ? " (simulação, nada foi gravado)" : ""}`);
