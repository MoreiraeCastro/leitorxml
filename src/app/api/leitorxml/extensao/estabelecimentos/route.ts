import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { registerDiscoveredEstablishment } from "@/lib/leitorxml/tasks";

export const runtime = "nodejs";

const bodySchema = z.object({
  cnpj: z.string().trim().length(14),
  razaoSocial: z.string().trim().min(1).max(250),
  inscricaoEstadual: z.string().trim().max(30).optional().nullable(),
  situacaoCadastral: z.string().trim().min(1).max(60),
  procuracaoGrupo: z.string().trim().min(1).max(120),
  posicao: z.number().int().positive(),
});

/** Chamada pela extensão durante a varredura de uma procuração — cadastra a empresa e cria as tarefas do mês automaticamente, sem passar pelo cadastro manual do Portal. */
export async function POST(request: Request) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const input = bodySchema.parse(await request.json());
    const result = await registerDiscoveredEstablishment(db, { ...input, inscricaoEstadual: input.inscricaoEstadual ?? null });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Revise os dados enviados." }, { status: 400 });
    return NextResponse.json({ error: "Não foi possível registrar a empresa." }, { status: 500 });
  }
}
