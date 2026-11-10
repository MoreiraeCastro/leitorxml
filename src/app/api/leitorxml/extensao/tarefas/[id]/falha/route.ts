import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";

export const runtime = "nodejs";
const falhaSchema = z.object({ motivo: z.string().trim().min(1).max(4000) });

/** Empresa que não aparece em nenhuma procuração (mensagens montadas em extension/src/background.js, DISCOVERY_NOT_FOUND). */
function isOutOfProcurations(motivo: string) {
  return motivo.includes("EMPRESA_FORA_DAS_PROCURACOES") || /não encontrado em nenhuma das \d+ procurações/.test(motivo);
}

/** CAPTCHA, bloqueio, confirmação inesperada ou qualquer mudança de tela não reconhecida — a automação para e pede intervenção (regra explícita do escopo original: nunca contornar controles de segurança). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const { id } = await params;
    const input = falhaSchema.parse(await request.json());
    const { data, error } = await db
      .from("xml_collection_tasks")
      .update({ status: "AGUARDANDO_INTERVENCAO", erro_mensagem: input.motivo, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id,establishment_id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
    if (isOutOfProcurations(input.motivo)) {
      // A extensão já percorreu TODAS as procurações atrás dessa empresa (~4 min). As outras tarefas dela dariam
      // a mesma volta inteira à toa (SAWA SWEETS, 10/11/2026: 3 voltas seguidas segurando a fila) — saem junto.
      await db
        .from("xml_collection_tasks")
        .update({ status: "AGUARDANDO_INTERVENCAO", erro_mensagem: input.motivo, updated_at: new Date().toISOString() })
        .eq("establishment_id", data.establishment_id)
        .in("status", ["AGENDADA", "NA_FILA"]);
    }
    await db.from("xml_watch_establishments").update({ locked_by_user_id: null, locked_at: null }).eq("id", data.establishment_id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Informe o motivo da falha." }, { status: 400 });
    return NextResponse.json({ error: "Não foi possível registrar a falha." }, { status: 500 });
  }
}
