import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyZipLink, zipResponse } from "@/lib/leitorxml/zip-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Conteúdo de um ZIP guardado em partes, remontado em fluxo. Acesso pelo link assinado (10 min) que a rota `arquivo` entrega. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  if (!verifyZipLink(id, Number(query.get("exp")), query.get("sig") ?? "")) {
    return NextResponse.json({ error: "Link expirado ou inválido." }, { status: 403 });
  }
  const db = createAdminClient();
  const { data: task } = await db.from("xml_collection_tasks").select("storage_path_zip").eq("id", id).maybeSingle();
  if (!task?.storage_path_zip) return NextResponse.json({ error: "Esta tarefa não tem arquivo em staging." }, { status: 404 });
  try {
    return await zipResponse(db, task.storage_path_zip);
  } catch {
    return NextResponse.json({ error: "Não foi possível montar o arquivo." }, { status: 500 });
  }
}
