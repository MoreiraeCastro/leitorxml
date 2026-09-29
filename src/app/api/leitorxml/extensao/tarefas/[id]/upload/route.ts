import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { validateCollectedZip } from "@/lib/leitorxml/upload-validation";

export const runtime = "nodejs";
const maxZipBytes = 50 * 1024 * 1024;

/** Recebe o ZIP baixado do Fisco Fácil, valida (descompactação segura, hash, chave de acesso) e grava em staging — o SharePoint ainda não está integrado (ver handoff), então o arquivo fica disponível para revisão até essa etapa existir. */
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
      return NextResponse.json({ error: "Arquivo ZIP inválido ou maior que o limite." }, { status: 422 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = validateCollectedZip(buffer);
    const resultadoValidacao = validation.ok ? (validation.accessKeysFound.length ? "OK" : "QUARENTENA") : "REJEITADO";

    storagePath = `tasks/${id}/${crypto.randomUUID()}.zip`;
    const { error: uploadError } = await db.storage.from("leitorxml-staging").upload(storagePath, buffer, { contentType: "application/zip", upsert: false });
    if (uploadError) return NextResponse.json({ error: "Não foi possível armazenar o arquivo." }, { status: 500 });

    const { error: fileInsertError } = await db.from("xml_collection_files").insert({
      task_id: id,
      hash_sha256: validation.hashSha256,
      tamanho_bytes: validation.totalBytes,
      quantidade_documentos: validation.accessKeysFound.length,
      resultado_validacao: resultadoValidacao,
      detalhes_validacao: { entryCount: validation.entryCount, reason: validation.reason ?? null },
    });
    if (fileInsertError) throw fileInsertError;

    const nextStatus = resultadoValidacao === "REJEITADO" ? "AGUARDANDO_INTERVENCAO" : "DISPONIVEL_REVISAO";
    await db.from("xml_collection_tasks").update({ status: nextStatus, storage_path_zip: storagePath, updated_at: new Date().toISOString() }).eq("id", id);
    if (nextStatus === "DISPONIVEL_REVISAO") await db.from("xml_watch_establishments").update({ locked_by_user_id: null, locked_at: null }).eq("id", task.establishment_id);

    storagePath = undefined;
    return NextResponse.json({ ok: true, resultadoValidacao, documentCount: validation.accessKeysFound.length }, { status: 201 });
  } catch {
    if (storagePath) await db.storage.from("leitorxml-staging").remove([storagePath]);
    return NextResponse.json({ error: "Não foi possível processar o upload." }, { status: 500 });
  }
}
