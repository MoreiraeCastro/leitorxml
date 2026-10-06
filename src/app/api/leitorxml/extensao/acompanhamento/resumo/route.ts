import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { summarizeTrackingNeeds } from "@/lib/leitorxml/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Só conta o que há pra conferir/baixar — não trava empresa. A extensão usa isso pra decidir se vale iniciar o acompanhamento automático. */
export async function GET(request: Request) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const stale = z.coerce.number().min(0).max(24 * 14).safeParse(new URL(request.url).searchParams.get("staleHours") ?? undefined);
    return NextResponse.json(await summarizeTrackingNeeds(db, stale.success ? { staleHours: stale.data } : {}));
  } catch {
    return NextResponse.json({ error: "Não foi possível resumir o acompanhamento." }, { status: 500 });
  }
}
