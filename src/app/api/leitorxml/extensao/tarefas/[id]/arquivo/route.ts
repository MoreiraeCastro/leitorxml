import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Link temporário (60 s) do ZIP já validado em staging, para a extensão salvá-lo na pasta do SharePoint do PC. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const { id } = await params;
    const { data: task, error } = await db.from("xml_collection_tasks").select("storage_path_zip").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!task?.storage_path_zip) return NextResponse.json({ error: "Esta tarefa não tem arquivo em staging." }, { status: 404 });
    const { data, error: signError } = await db.storage.from("leitorxml-staging").createSignedUrl(task.storage_path_zip, 60);
    if (signError || !data?.signedUrl) throw signError ?? new Error("SIGN_FAILED");
    return NextResponse.json({ url: data.signedUrl });
  } catch {
    return NextResponse.json({ error: "Não foi possível gerar o link do arquivo." }, { status: 500 });
  }
}
