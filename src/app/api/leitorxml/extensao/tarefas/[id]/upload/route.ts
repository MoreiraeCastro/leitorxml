import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { registerCollectedZip } from "@/lib/leitorxml/collected-zip";
import { ZIP_BUCKET } from "@/lib/leitorxml/zip-storage";

export const runtime = "nodejs";
// O Storage recusa objeto acima de 50 MB: maior que isso vem em partes (upload/parte + upload/concluir). A extensão
// já divide acima de 40 MB; 48 MB aqui só mantém funcionando versões antigas que mandavam inteiro até 50 MB.
const maxZipBytes = 48 * 1024 * 1024;

/** Recebe o ZIP baixado do Fisco Fácil, valida (descompactação segura, hash, chave de acesso) e grava em staging. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  let storagePath: string | undefined;
  try {
    const { id } = await params;
    const { data: task, error: taskError } = await db.from("xml_collection_tasks").select("id,establishment_id").eq("id", id).maybeSingle();
    if (taskError) throw taskError;
    if (!task) return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Envie o arquivo ZIP recebido do Fisco Fácil." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".zip") || file.size === 0 || file.size > maxZipBytes) {
      return NextResponse.json({ error: "Arquivo ZIP inválido ou maior que o limite (envie em partes)." }, { status: 422 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());

    storagePath = `tasks/${id}/${crypto.randomUUID()}.zip`;
    const { error: uploadError } = await db.storage.from(ZIP_BUCKET).upload(storagePath, buffer, { contentType: "application/zip", upsert: false });
    if (uploadError) return NextResponse.json({ error: "Não foi possível armazenar o arquivo." }, { status: 500 });

    const result = await registerCollectedZip(db, task, buffer, storagePath);
    storagePath = undefined;
    return NextResponse.json(result, { status: 201 });
  } catch {
    if (storagePath) await db.storage.from(ZIP_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: "Não foi possível processar o upload." }, { status: 500 });
  }
}
