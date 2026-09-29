"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOfficeSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTasksForEstablishments } from "@/lib/leitorxml/tasks";

const schema = z.object({
  establishmentIds: z.array(z.uuid()).min(1, "Selecione pelo menos um estabelecimento."),
  competenciaAno: z.coerce.number().int().min(2020).max(2100),
  competenciaMes: z.coerce.number().int().min(1).max(12),
});

export async function dispararExtracao(formData: FormData) {
  const session = await requireOfficeSession();
  const input = schema.parse({
    establishmentIds: formData.getAll("establishmentIds"),
    competenciaAno: formData.get("competenciaAno"),
    competenciaMes: formData.get("competenciaMes"),
  });
  const db = createAdminClient();
  const result = await createTasksForEstablishments(db, input);
  await db.from("audit_logs").insert({
    actor_user_id: session.userId,
    organization_id: null,
    actor_type: "OFFICE",
    action: "leitorxml_tasks_created",
    entity: "xml_collection_task",
    entity_id: null,
    safe_metadata: { competenciaAno: input.competenciaAno, competenciaMes: input.competenciaMes, tasksCreated: result.tasksCreated, skipped: result.skipped },
  });
  redirect(`/painel?ano=${input.competenciaAno}&mes=${input.competenciaMes}`);
}
