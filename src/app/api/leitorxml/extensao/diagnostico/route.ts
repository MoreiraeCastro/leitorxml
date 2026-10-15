import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";

export const runtime = "nodejs";

const schema = z.object({
  tipo: z.enum(["VISITA_ACOMPANHAMENTO_FALHOU"]),
  establishmentId: z.string().uuid().nullable().optional(),
  motivo: z.string().max(4000),
  rastro: z.string().max(6000).optional(),
});

/**
 * Falhas da extensão que não pertencem a uma tarefa só — ex.: a visita a uma empresa no acompanhamento travou antes de
 * conferir qualquer pedido. Antes isso ficava só na memória do Chrome (15/10/2026: "0 empresa(s) conferida(s), 1
 * falha(s)" sem como saber o motivo); agora vai pra auditoria.
 */
export async function POST(request: Request) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"), request.headers.get("x-leitor-versao"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const input = schema.parse(await request.json());
    await db.from("audit_logs").insert({
      actor_user_id: identity.userId, organization_id: null, actor_type: "OFFICE", action: "leitorxml_extension_diagnostic",
      entity: "xml_watch_establishment", entity_id: input.establishmentId ?? null,
      safe_metadata: { tipo: input.tipo, motivo: input.motivo, rastro: input.rastro ?? null, versao: request.headers.get("x-leitor-versao") },
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Diagnóstico inválido." }, { status: 400 });
    return NextResponse.json({ error: "Não foi possível registrar o diagnóstico." }, { status: 500 });
  }
}
