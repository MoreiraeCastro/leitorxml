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
    // O diagnóstico (estado da aba + rastro da corrida) não fica na tarefa, que volta limpa pra fila: vai pra auditoria,
    // pra dar pra investigar depois por que o Fisco não carregou.
    const body = await request.json().catch(() => ({}));
    const diagnostico = typeof body?.diagnostico === "string" ? body.diagnostico.slice(0, 3000) : null;
    await db.from("audit_logs").insert({
      actor_user_id: identity.userId, organization_id: null, actor_type: "OFFICE", action: "leitorxml_task_returned_pc_problem",
      entity: "xml_collection_task", entity_id: id, safe_metadata: diagnostico ? { diagnostico } : {},
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Não foi possível devolver a tarefa." }, { status: 500 });
  }
}
