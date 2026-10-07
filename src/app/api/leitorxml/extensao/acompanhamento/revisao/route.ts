import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { DELIVERY_SELECT, toDeliveryItems } from "@/lib/leitorxml/entregas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ZIPs que aguardam revisão — a extensão guarda uma cópia na pasta Downloads do PC de quem revisa. Não depende de já ter sido entregue ao SharePoint. */
export async function GET(request: Request) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const { data, error } = await db
      .from("xml_collection_tasks")
      .select(DELIVERY_SELECT)
      .eq("status", "DISPONIVEL_REVISAO")
      .not("storage_path_zip", "is", null)
      .order("updated_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    return NextResponse.json({ items: toDeliveryItems(data ?? []) });
  } catch {
    return NextResponse.json({ error: "Não foi possível listar os arquivos para revisão." }, { status: 500 });
  }
}
