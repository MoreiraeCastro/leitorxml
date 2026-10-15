import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { registerCollectedZip } from "@/lib/leitorxml/collected-zip";
import { MAX_PARTS, partitionedPath, readZip, removeZip } from "@/lib/leitorxml/zip-storage";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({ uploadId: z.string().regex(/^[0-9a-f-]{36}$/), total: z.number().int().min(2).max(MAX_PARTS) });

/** Fecha um upload em partes: remonta o ZIP a partir das partes no Storage, valida e registra (as partes ficam como estão). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  let storagePath: string | undefined;
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const { data: task, error: taskError } = await db.from("xml_collection_tasks").select("id,establishment_id").eq("id", id).maybeSingle();
    if (taskError) throw taskError;
    if (!task) return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });

    storagePath = partitionedPath(`tasks/${id}/${input.uploadId}.zip`, input.total);
    let buffer: Buffer;
    try {
      buffer = await readZip(db, storagePath);
    } catch (error) {
      return NextResponse.json({ error: `Faltam partes do ZIP: ${error instanceof Error ? error.message : error}` }, { status: 422 });
    }
    const result = await registerCollectedZip(db, task, buffer, storagePath);
    storagePath = undefined;
    return NextResponse.json({ ...result, bytes: buffer.length, partes: input.total }, { status: 201 });
  } catch (error) {
    if (storagePath) await removeZip(db, storagePath).catch(() => {});
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Revise os dados do envio." }, { status: 400 });
    return NextResponse.json({ error: "Não foi possível concluir o upload em partes." }, { status: 500 });
  }
}
