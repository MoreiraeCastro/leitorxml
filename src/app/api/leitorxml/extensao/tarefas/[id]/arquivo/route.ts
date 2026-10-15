import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { ZIP_BUCKET, parsePartitioned, signZipLink } from "@/lib/leitorxml/zip-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Link temporário do ZIP já validado em staging, para a extensão salvá-lo na pasta do SharePoint do PC. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const { id } = await params;
    const { data: task, error } = await db.from("xml_collection_tasks").select("storage_path_zip").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!task?.storage_path_zip) return NextResponse.json({ error: "Esta tarefa não tem arquivo em staging." }, { status: 404 });
    if (parsePartitioned(task.storage_path_zip)) {
      // ZIP em partes: o link aponta pra rota que remonta o arquivo (chrome.downloads não manda o token, então vai assinado).
      const expiresAt = Date.now() + 10 * 60_000;
      const url = new URL(request.url);
      url.pathname = url.pathname.replace(/\/arquivo\/?$/, "/arquivo/conteudo");
      url.search = new URLSearchParams({ exp: String(expiresAt), sig: signZipLink(id, expiresAt) }).toString();
      const proto = request.headers.get("x-forwarded-proto");
      const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
      if (proto) url.protocol = `${proto}:`;
      if (host) url.host = host;
      return NextResponse.json({ url: url.toString() });
    }
    const { data, error: signError } = await db.storage.from(ZIP_BUCKET).createSignedUrl(task.storage_path_zip, 60);
    if (signError || !data?.signedUrl) throw signError ?? new Error("SIGN_FAILED");
    return NextResponse.json({ url: data.signedUrl });
  } catch {
    return NextResponse.json({ error: "Não foi possível gerar o link do arquivo." }, { status: 500 });
  }
}
