import { createAdminClient } from "@/lib/supabase/admin";
import { SharePointPanel } from "@/components/sharepoint-panel";
import { SharePointSetup } from "@/components/sharepoint-setup";
import { getSharePointConnection, sharePointConfigured } from "@/lib/leitorxml/sharepoint";
import { documentLabel, roleLabel } from "@/lib/leitorxml/status-labels";

const IN_REVIEW = ["DISPONIVEL_REVISAO", "REVISADO"];

type Delivered = {
  id: string;
  tipo_documento: "NFE" | "NFCE";
  papel: "EMITENTE" | "DESTINATARIO";
  sharepoint_item_id: string | null;
  updated_at: string;
  xml_watch_establishments: { razao_social: string } | { razao_social: string }[] | null;
};

export async function SharePointSection() {
  const db = createAdminClient();
  const connection = await getSharePointConnection(db).catch(() => null);

  // "Aguardando" = ZIP validado em staging que ainda não chegou ao SharePoint por NENHUM caminho (pasta do PC ou envio direto).
  const { count: pendentes } = await db.from("xml_collection_tasks").select("id", { count: "exact", head: true })
    .in("status", IN_REVIEW).is("sharepoint_path", null).is("sharepoint_item_id", null).not("storage_path_zip", "is", null);
  const { count: entregues } = await db.from("xml_collection_tasks").select("id", { count: "exact", head: true })
    .or("sharepoint_path.not.is.null,sharepoint_item_id.not.is.null");
  const { data: recentes } = await db
    .from("xml_collection_tasks")
    .select("id,tipo_documento,papel,sharepoint_item_id,updated_at,xml_watch_establishments(razao_social)")
    .or("sharepoint_path.not.is.null,sharepoint_item_id.not.is.null")
    .order("updated_at", { ascending: false })
    .limit(6);
  const rows = (recentes as Delivered[] | null) ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
        <div className="rounded-xl border border-black/10 bg-white px-4 py-3">
          <div className="text-2xl font-semibold text-[#082240]">{entregues ?? 0}</div>
          <div className="text-xs text-black/50">entregues na pasta</div>
        </div>
        <div className={`rounded-xl border px-4 py-3 ${(pendentes ?? 0) > 0 ? "border-amber-200 bg-amber-50" : "border-black/10 bg-white"}`}>
          <div className="text-2xl font-semibold text-[#082240]">{pendentes ?? 0}</div>
          <div className="text-xs text-black/50">aguardando entrega</div>
        </div>
      </div>

      <SharePointSetup referenceName={connection?.rootName ?? null} referenceUrl={connection?.rootWebUrl ?? null} />

      {!!rows.length && (
        <div className="overflow-x-auto rounded-xl border border-black/10 bg-white">
          <div className="border-b border-black/10 px-5 py-3 text-sm font-medium text-[#082240]">Últimas entregas</div>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {rows.map((row) => {
                const establishment = Array.isArray(row.xml_watch_establishments) ? row.xml_watch_establishments[0] : row.xml_watch_establishments;
                return (
                  <tr key={row.id} className="border-b border-black/5 last:border-0">
                    <td className="px-5 py-2">{establishment?.razao_social ?? "—"}</td>
                    <td className="px-5 py-2 text-black/60">{documentLabel(row.tipo_documento)} · {roleLabel(row.papel)}</td>
                    <td className="px-5 py-2 text-black/50">{new Date(row.updated_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-5 py-2 text-black/50">{row.sharepoint_item_id ? "Envio direto" : "Pasta do PC"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details className="rounded-xl border border-black/10 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-[#082240]">Avançado: envio direto pelo servidor</summary>
        <div className="px-5 pb-4">
          <p className="mb-3 text-sm text-black/60">Precisa da aprovação do administrador do Microsoft 365. Dispensa o atalho em cada PC.</p>
          <SharePointPanel
            configured={sharePointConfigured()}
            connected={Boolean(connection?.hasRefreshToken)}
            account={connection?.account ?? null}
            hasRoot={Boolean(connection?.hasRootFolder)}
            rootName={connection?.rootName ?? null}
            rootWebUrl={connection?.rootWebUrl ?? null}
            pendingCount={pendentes ?? 0}
          />
        </div>
      </details>
    </div>
  );
}
