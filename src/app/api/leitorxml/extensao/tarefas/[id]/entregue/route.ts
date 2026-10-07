import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";

export const runtime = "nodejs";
const bodySchema = z.object({ path: z.string().trim().min(1).max(500) });

/** A extensão salvou o ZIP na pasta sincronizada do SharePoint: registra o caminho (prefixo "local:" = entrega pelo PC, não pelo envio direto do servidor). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const { id } = await params;
    const { path } = bodySchema.parse(await request.json());
    const { data, error } = await db
      .from("xml_collection_tasks")
      .update({ sharepoint_path: `local: ${path}`, updated_at: new Date().toISOString() })
      .eq("id", id)
      .not("storage_path_zip", "is", null)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Tarefa não encontrada ou sem arquivo." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Caminho inválido." }, { status: 400 });
    return NextResponse.json({ error: "Não foi possível registrar a entrega." }, { status: 500 });
  }
}
