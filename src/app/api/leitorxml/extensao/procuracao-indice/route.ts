import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { upsertProcurationIndex } from "@/lib/leitorxml/procuration-index";

export const runtime = "nodejs";
const entrySchema = z.object({
  procuracaoGrupo: z.string().trim().min(1).max(120),
  posicao: z.number().int().positive(),
  cnpj: z.string().trim().length(14),
  situacaoCadastral: z.string().trim().min(1).max(60),
});
const bodySchema = z.object({ entries: z.array(entrySchema).min(1).max(200) });

export async function POST(request: Request) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const input = bodySchema.parse(await request.json());
    await upsertProcurationIndex(db, input.entries);
    return NextResponse.json({ ok: true, upserted: input.entries.length });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Revise as entradas do índice." }, { status: 400 });
    return NextResponse.json({ error: "Não foi possível atualizar o índice de procurações." }, { status: 500 });
  }
}
