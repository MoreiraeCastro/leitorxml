import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { claimNextTask } from "@/lib/leitorxml/tasks";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const claimed = await claimNextTask(db, identity.userId);
    if (!claimed) return NextResponse.json({ task: null });
    return NextResponse.json({
      task: {
        id: claimed.task.id,
        competenciaAno: claimed.task.competencia_ano,
        competenciaMes: claimed.task.competencia_mes,
        tipoDocumento: claimed.task.tipo_documento,
        papel: claimed.task.papel,
      },
      establishment: { id: claimed.establishment.id, cnpj: claimed.establishment.cnpj, razaoSocial: claimed.establishment.razao_social },
      accessContext: claimed.accessContext,
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível localizar a próxima tarefa." }, { status: 500 });
  }
}
