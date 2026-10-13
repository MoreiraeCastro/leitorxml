import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { DELIVERY_SELECT, toDeliveryItems } from "@/lib/leitorxml/entregas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Quanto tempo um pedido já "Baixado ✓" continua na lista: dá tempo do outro PC do escritório também guardar a cópia dele. */
const BAIXADO_RECENTE_DIAS = 45;

/**
 * ZIPs que cada PC guarda na pasta Downloads: os ainda não baixados por ninguém e os baixados recentemente (os dois PCs
 * ficam com cópia). `baixado` diz se o check já foi dado — a extensão marca o check ao salvar quando ainda não foi.
 */
export async function GET(request: Request) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const recentSince = new Date(Date.now() - BAIXADO_RECENTE_DIAS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await db
      .from("xml_collection_tasks")
      .select(`${DELIVERY_SELECT},status`)
      .or(`status.eq.DISPONIVEL_REVISAO,and(status.eq.BAIXADO,baixado_at.gte.${recentSince})`)
      .not("storage_path_zip", "is", null)
      .order("updated_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    const baixados = new Set((data ?? []).filter((row) => row.status === "BAIXADO").map((row) => row.id as string));
    return NextResponse.json({ items: toDeliveryItems(data ?? []).map((item) => ({ ...item, baixado: baixados.has(item.taskId) })) });
  } catch {
    return NextResponse.json({ error: "Não foi possível listar os arquivos para revisão." }, { status: 500 });
  }
}
