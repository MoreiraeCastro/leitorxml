import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";

export const runtime = "nodejs";

/**
 * A extensão salvou o ZIP na pasta de um PC (cópia em Downloads ou entrega na pasta do SharePoint): marca o check
 * "Baixado ✓" com data e quem baixou. Só o PRIMEIRO PC que salvar marca — os seguintes recebem ok sem mudar nada.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const { id } = await params;
    const now = new Date().toISOString();
    const { data, error } = await db
      .from("xml_collection_tasks")
      .update({ status: "BAIXADO", baixado_at: now, baixado_por_nome: identity.displayName, updated_at: now })
      .eq("id", id)
      .eq("status", "DISPONIVEL_REVISAO")
      .not("storage_path_zip", "is", null)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ ok: true, marcado: Boolean(data) });
  } catch {
    return NextResponse.json({ error: "Não foi possível marcar como baixado." }, { status: 500 });
  }
}
