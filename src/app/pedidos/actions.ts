"use server";
import { revalidatePath } from "next/cache";
import { requireOfficeSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export async function marcarRevisado(id: string) {
  const session = await requireOfficeSession();
  const db = createAdminClient();
  const { data, error } = await db
    .from("xml_collection_tasks")
    .update({ status: "REVISADO", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "DISPONIVEL_REVISAO")
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Não foi possível marcar como revisado.");
  if (!data) throw new Error("Esta tarefa não está disponível para revisão no momento.");
  await db.from("audit_logs").insert({ actor_user_id: session.userId, organization_id: null, actor_type: "OFFICE", action: "leitorxml_task_reviewed", entity: "xml_collection_task", entity_id: id, safe_metadata: {} });
  revalidatePath(`/pedidos/${id}`);
}
