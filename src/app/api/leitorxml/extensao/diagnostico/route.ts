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
    // A conferência pega as empresas pelo updated_at mais antigo. Visita que falhou não mexia nele, então as mesmas
    // empresas (fora da procuração anotada) vinham primeiro em toda passada, davam 3 falhas seguidas e a esteira
    // parava sem conferir o resto (10/11/2026: 189 pedidos parados atrás de 3 empresas). Joga a empresa pro fim da fila.
    if (input.tipo === "VISITA_ACOMPANHAMENTO_FALHOU" && input.establishmentId) {
      const now = new Date();
      // Empresa que some da procuração de novo (2ª vez em 24h) não vai aparecer na próxima passada: em vez de abrir
      // toda conferência e contar falha, os pedidos dela vão para "Precisa de ajuda" (10/11/2026: 7 empresas pedidas
      // de manhã sumiram das procurações à tarde e paravam a esteira a cada passada).
      let sumiu = false;
      if (input.motivo.startsWith("EMPRESA_NAO_ENCONTRADA_NA_PROCURACAO")) {
        const { count } = await db.from("audit_logs").select("id", { count: "exact", head: true })
          .eq("action", "leitorxml_extension_diagnostic").eq("entity_id", input.establishmentId)
          .like("safe_metadata->>motivo", "EMPRESA_NAO_ENCONTRADA_NA_PROCURACAO%")
          .gte("created_at", new Date(now.getTime() - 24 * 3600 * 1000).toISOString());
        sumiu = (count ?? 0) >= 2; // conta o registro que acabou de entrar
      }
      await db.from("xml_collection_tasks")
        .update(sumiu
          ? { status: "AGUARDANDO_INTERVENCAO", erro_mensagem: `${input.motivo.split(" [Passos")[0]} — 2 conferências seguidas sem achar a empresa; conferir no Fisco Fácil se a procuração dela continua ativa e pedir de novo.`.slice(0, 1000), updated_at: now.toISOString() }
          : { updated_at: now.toISOString() })
        .eq("establishment_id", input.establishmentId).in("status", ["SOLICITADO", "PROCESSANDO_SEFAZ", "PRONTO_PARA_BAIXAR"]);
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Diagnóstico inválido." }, { status: 400 });
    return NextResponse.json({ error: "Não foi possível registrar o diagnóstico." }, { status: 500 });
  }
}
