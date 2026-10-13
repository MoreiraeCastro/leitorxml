import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { DELIVERY_SELECT, toDeliveryItems } from "@/lib/leitorxml/entregas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ZIPs já validados e em staging que ainda não foram entregues na pasta do SharePoint — a extensão salva cada um no PC (atalho do OneDrive) e marca como entregue. */
export async function GET(request: Request) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const { data, error } = await db
      .from("xml_collection_tasks")
      .select(DELIVERY_SELECT)
      .in("status", ["DISPONIVEL_REVISAO", "BAIXADO", "REVISADO"])
      .is("sharepoint_path", null)
      .is("sharepoint_item_id", null)
      .not("storage_path_zip", "is", null)
      .order("updated_at", { ascending: true })
      .limit(25);
    if (error) throw error;
    return NextResponse.json({ items: toDeliveryItems(data ?? []) });
  } catch {
    return NextResponse.json({ error: "Não foi possível listar as entregas pendentes." }, { status: 500 });
  }
}
