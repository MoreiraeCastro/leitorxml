import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { MAX_PARTS, PART_BYTES, ZIP_BUCKET, partObjectPath } from "@/lib/leitorxml/zip-storage";

export const runtime = "nodejs";

const UPLOAD_ID = /^[0-9a-f-]{36}$/;

/**
 * Uma parte de um ZIP grande (corpo cru, até PART_BYTES): vai direto pro Storage como objeto próprio. Nada é
 * validado aqui — o ZIP só existe inteiro no `upload/concluir`, que junta, valida e registra.
 * Query: uploadId (uuid gerado pela extensão), indice (0..total-1), total.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    const uploadId = query.get("uploadId") ?? "";
    const indice = Number(query.get("indice"));
    const total = Number(query.get("total"));
    if (!UPLOAD_ID.test(uploadId) || !Number.isInteger(total) || total < 2 || total > MAX_PARTS || !Number.isInteger(indice) || indice < 0 || indice >= total) {
      return NextResponse.json({ error: "Parte inválida." }, { status: 400 });
    }
    const { data: task, error: taskError } = await db.from("xml_collection_tasks").select("id").eq("id", id).maybeSingle();
    if (taskError) throw taskError;
    if (!task) return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });

    const buffer = Buffer.from(await request.arrayBuffer());
    if (buffer.length === 0 || buffer.length > PART_BYTES) return NextResponse.json({ error: "Parte vazia ou maior que o limite." }, { status: 422 });
    if (indice === 0 && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) return NextResponse.json({ error: "A 1ª parte não começa como ZIP." }, { status: 422 });

    const path = partObjectPath(`tasks/${id}/${uploadId}.zip`, indice);
    const { error } = await db.storage.from(ZIP_BUCKET).upload(path, buffer, { contentType: "application/octet-stream", upsert: true });
    if (error) return NextResponse.json({ error: `Não foi possível armazenar a parte ${indice + 1}.` }, { status: 500 });
    return NextResponse.json({ ok: true, indice, bytes: buffer.length }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Não foi possível receber a parte." }, { status: 500 });
  }
}
