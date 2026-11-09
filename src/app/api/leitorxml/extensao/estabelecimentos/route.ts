import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { registerDiscoveredEstablishment } from "@/lib/leitorxml/tasks";
import { discoveredEstablishmentSchema } from "@/lib/leitorxml/establishments";
import { logEvent } from "@/lib/observability/logger";

export const runtime = "nodejs";


/** Chamada pela extensão durante a varredura de uma procuração — cadastra a empresa e cria as tarefas do mês automaticamente, sem passar pelo cadastro manual do Portal. */
export async function POST(request: Request) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  let body: unknown = null;
  try {
    body = await request.json();
    const input = discoveredEstablishmentSchema.parse(body);
    const result = await registerDiscoveredEstablishment(db, { ...input, inscricaoEstadual: input.inscricaoEstadual ?? null });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Fica no log do serviço qual campo veio fora do formato, para a empresa não sumir sem rastro.
      const cnpj = body && typeof body === "object" ? (body as Record<string, unknown>).cnpj : null;
      logEvent("warn", "LEITORXML_ESTABELECIMENTO_RECUSADO", { cnpj, problemas: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) });
      return NextResponse.json({ error: "Revise os dados enviados." }, { status: 400 });
    }
    return NextResponse.json({ error: "Não foi possível registrar a empresa." }, { status: 500 });
  }
}
