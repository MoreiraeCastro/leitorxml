"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOfficeSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateMonthlyTasks } from "@/lib/leitorxml/tasks";

const schema = z.object({
  competenciaAno: z.coerce.number().int().min(2020).max(2100),
  competenciaMes: z.coerce.number().int().min(1).max(12),
});

/** "Criar tarefas do mês": as 3 tarefas de TODAS as empresas ativas (a mesma geração que o sistema faz sozinho a partir do dia 10). Idempotente: o que já existe não duplica. */
export async function criarTarefasDoMes(formData: FormData) {
  const session = await requireOfficeSession();
  const input = schema.parse({ competenciaAno: formData.get("competenciaAno"), competenciaMes: formData.get("competenciaMes") });
  const db = createAdminClient();
  const result = await generateMonthlyTasks(db, input);
  await db.from("audit_logs").insert({
    actor_user_id: session.userId,
    organization_id: null,
    actor_type: "OFFICE",
    action: "leitorxml_tasks_created",
    entity: "xml_collection_task",
    entity_id: null,
    safe_metadata: { ...input, tasksCreated: result.tasksCreated, establishments: result.establishments, origem: "inicio" },
  });
  redirect(`/painel?ano=${input.competenciaAno}&mes=${input.competenciaMes}`);
}
