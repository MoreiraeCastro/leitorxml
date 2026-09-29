import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";

export const runtime = "nodejs";
const eventoSchema = z.object({
  status: z.enum([
    "NA_FILA", "AUTENTICANDO", "SELECIONANDO_CONTEXTO", "SOLICITADO", "PROCESSANDO_SEFAZ",
    "SEM_DOCUMENTOS", "PRONTO_PARA_BAIXAR", "BAIXANDO", "VALIDANDO", "DISPONIVEL_REVISAO", "REVISADO", "EXPIRADA",
  ]),
  sefazReferencia: z.string().trim().max(120).optional(),
  sefazPrevisaoConclusao: z.iso.datetime().optional(),
});
const finalStatuses = new Set(["DISPONIVEL_REVISAO", "SEM_DOCUMENTOS", "EXPIRADA", "REVISADO"]);

/** A extensão reporta cada transição de estado da tarefa (autenticando → solicitado → processando → pronto/sem documentos/expirada). Estados finais liberam a trava do estabelecimento para a próxima empresa. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const { id } = await params;
    const input = eventoSchema.parse(await request.json());
    const update: Record<string, unknown> = { status: input.status, ultima_verificacao_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (input.sefazReferencia) update.sefaz_referencia = input.sefazReferencia;
    if (input.sefazPrevisaoConclusao) update.sefaz_previsao_conclusao = input.sefazPrevisaoConclusao;
    const { data, error } = await db.from("xml_collection_tasks").update(update).eq("id", id).select("id,establishment_id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
    if (finalStatuses.has(input.status)) {
      await db.from("xml_watch_establishments").update({ locked_by_user_id: null, locked_at: null }).eq("id", data.establishment_id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Revise os dados do evento." }, { status: 400 });
    return NextResponse.json({ error: "Não foi possível registrar o evento." }, { status: 500 });
  }
}
