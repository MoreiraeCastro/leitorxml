import { NextResponse } from "next/server";
import { requireOfficeSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Entrega ao escritório o ZIP retido em staging (URL assinada de 60s) — só para equipe autenticada. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOfficeSession();
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const { id } = await params;
  const db = createAdminClient();
  const { data: task } = await db
    .from("xml_collection_tasks")
    .select("storage_path_zip,tipo_documento,papel,competencia_ano,competencia_mes,xml_watch_establishments(cnpj)")
    .eq("id", id)
    .maybeSingle();
  if (!task?.storage_path_zip) return NextResponse.json({ error: "Esta tarefa não tem arquivo em staging." }, { status: 404 });
  const establishment = Array.isArray(task.xml_watch_establishments) ? task.xml_watch_establishments[0] : task.xml_watch_establishments;
  const filename = `${establishment?.cnpj ?? "empresa"}_${task.tipo_documento}_${task.papel}_${task.competencia_ano}-${String(task.competencia_mes).padStart(2, "0")}.zip`;
  const { data, error } = await db.storage.from("leitorxml-staging").createSignedUrl(task.storage_path_zip, 60, { download: filename });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Não foi possível gerar o link de download." }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
