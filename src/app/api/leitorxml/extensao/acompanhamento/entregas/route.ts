import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { deliveryPath } from "@/lib/leitorxml/sharepoint-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Establishment = { cnpj: string; razao_social: string; sharepoint_folder_path: string | null };

/** ZIPs já validados e em staging que ainda não foram entregues na pasta do SharePoint — a extensão salva cada um no PC (atalho do OneDrive) e marca como entregue. */
export async function GET(request: Request) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const { data, error } = await db
      .from("xml_collection_tasks")
      .select("id,tipo_documento,papel,competencia_ano,competencia_mes,xml_watch_establishments(cnpj,razao_social,sharepoint_folder_path)")
      .in("status", ["DISPONIVEL_REVISAO", "REVISADO"])
      .is("sharepoint_path", null)
      .is("sharepoint_item_id", null)
      .not("storage_path_zip", "is", null)
      .order("updated_at", { ascending: true })
      .limit(25);
    if (error) throw error;
    const items = (data ?? []).flatMap((row) => {
      const raw = row.xml_watch_establishments as Establishment | Establishment[] | null;
      const establishment = Array.isArray(raw) ? raw[0] : raw;
      if (!establishment) return [];
      return [{
        taskId: row.id as string,
        path: deliveryPath({
          cnpj: establishment.cnpj, razaoSocial: establishment.razao_social, folderPath: establishment.sharepoint_folder_path,
          tipo: row.tipo_documento as string, papel: row.papel as string, ano: row.competencia_ano as number, mes: row.competencia_mes as number,
        }),
      }];
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "Não foi possível listar as entregas pendentes." }, { status: 500 });
  }
}
