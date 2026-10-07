"use server";
import { revalidatePath } from "next/cache";
import { requireOfficeSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { REQUEST_AGAIN_STATUSES } from "@/lib/leitorxml/status-labels";

/**
 * "Pedir de novo": devolve à fila uma tarefa que expirou (passou dos 7 dias no Fisco Fácil) ou falhou. Limpa tudo o que era
 * da tentativa anterior e a coloca à frente da fila (é urgente), pra a próxima esteira de solicitações pegá-la primeiro.
 * Só age em tarefa EXPIRADA / FALHA / AGUARDANDO_INTERVENCAO — nunca em uma que já tem arquivo em revisão.
 */
export async function pedirDeNovo(id: string) {
  const session = await requireOfficeSession();
  const db = createAdminClient();
  const { data, error } = await db
    .from("xml_collection_tasks")
    .update({
      status: "AGENDADA",
      sefaz_referencia: null,
      sefaz_previsao_conclusao: null,
      ultima_verificacao_at: null,
      proxima_verificacao_at: null,
      prazo_alerta_at: null,
      erro_mensagem: null,
      tentativas: 0,
      updated_at: "2020-01-01T00:00:00Z",
    })
    .eq("id", id)
    .in("status", [...REQUEST_AGAIN_STATUSES])
    .select("id,establishment_id")
    .maybeSingle();
  if (error) throw new Error("Não foi possível pedir de novo.");
  if (!data) throw new Error("Esta tarefa não está em um estado que permita pedir de novo.");
  await db.from("audit_logs").insert({ actor_user_id: session.userId, organization_id: null, actor_type: "OFFICE", action: "leitorxml_task_request_again", entity: "xml_collection_task", entity_id: id, safe_metadata: {} });
  revalidatePath(`/pedidos/${id}`);
  revalidatePath("/painel");
}

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
