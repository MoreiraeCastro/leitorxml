import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOfficeSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTasksForEstablishments } from "@/lib/leitorxml/tasks";

export const runtime = "nodejs";
const bodySchema = z.object({
  establishmentIds: z.array(z.uuid()).min(1).max(200),
  competenciaAno: z.number().int().min(2020).max(2100),
  competenciaMes: z.number().int().min(1).max(12),
});

/** Endpoint que a futura tela "Nova extração" vai chamar: cria as tarefas para os estabelecimentos e a competência selecionados manualmente. */
export async function POST(request: Request) {
  try {
    const session = await requireOfficeSession();
    const input = bodySchema.parse(await request.json());
    const result = await createTasksForEstablishments(createAdminClient(), input);
    await createAdminClient().from("audit_logs").insert({
      actor_user_id: session.userId,
      organization_id: null,
      actor_type: "OFFICE",
      action: "leitorxml_tasks_created",
      entity: "xml_collection_task",
      entity_id: null,
      safe_metadata: { competenciaAno: input.competenciaAno, competenciaMes: input.competenciaMes, tasksCreated: result.tasksCreated, skipped: result.skipped },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Revise a seleção de estabelecimentos e competência." }, { status: 400 });
    if (error instanceof Error && ["UNAUTHENTICATED", "FORBIDDEN_OFFICE", "AUTH_CONFIGURATION_REQUIRED"].includes(error.message)) {
      return NextResponse.json({ error: "Acesso do escritório necessário." }, { status: 403 });
    }
    return NextResponse.json({ error: "Não foi possível criar as tarefas." }, { status: 500 });
  }
}
