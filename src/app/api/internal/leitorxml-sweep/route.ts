import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest, runLeitorXmlSweep } from "@/lib/leitorxml/sweep";
import { logEvent } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-to-server only, mesmo padrão de /api/internal/reconcile-pending:
 * chamado por um cron externo a cada 3 dias, autenticado por segredo
 * compartilhado, nunca por sessão de usuário.
 */
export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request.headers.get("x-internal-secret"), process.env.INTERNAL_LEITORXML_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runLeitorXmlSweep({ db: createAdminClient() });
    logEvent("info", "LEITORXML_SWEEP", result);
    return NextResponse.json(result);
  } catch (error) {
    logEvent("error", "LEITORXML_SWEEP_FAILED", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Não foi possível rodar a varredura do Leitor de XML." }, { status: 500 });
  }
}
