import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";

export const runtime = "nodejs";

/**
 * A corrida nem começou por um problema do PC (Fisco Fácil não carregou: sessão caída, Chrome esperando a escolha do
 * certificado) — a tarefa não tem culpa. Devolve à fila em vez de marcar falha, e solta a trava da empresa.
 * Só age em AUTENTICANDO: nunca desfaz uma tarefa que já avançou.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const { id } = await params;
    const { data, error } = await db
      .from("xml_collection_tasks")
      .update({ status: "AGENDADA", erro_mensagem: null, updated_at: "2020-01-01T00:00:00Z" })
      .eq("id", id)
      .eq("status", "AUTENTICANDO")
      .select("id,establishment_id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Tarefa não está em andamento." }, { status: 409 });
    await db.from("xml_watch_establishments").update({ locked_by_user_id: null, locked_at: null }).eq("id", data.establishment_id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Não foi possível devolver a tarefa." }, { status: 500 });
  }
}
