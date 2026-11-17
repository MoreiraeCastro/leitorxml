import { createAdminClient } from "@/lib/supabase/admin";
import { SharePointPanel } from "@/components/sharepoint-panel";
import { SharePointSetup } from "@/components/sharepoint-setup";
import { getSharePointConnection, sharePointConfigured } from "@/lib/leitorxml/sharepoint";
import { documentLabel, roleLabel } from "@/lib/leitorxml/status-labels";

const IN_REVIEW = ["DISPONIVEL_REVISAO", "BAIXADO", "REVISADO"];

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
      <div className="kpis sm:max-w-md">
        <div className="kpi">
          <div className="kpi-label">Entregues na pasta</div>
          <div className="kpi-value">{entregues ?? 0}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">
            {(pendentes ?? 0) > 0 && <span className="dot text-[var(--warn)]" aria-hidden="true" />}
            Aguardando entrega
          </div>
          <div className="kpi-value">{pendentes ?? 0}</div>
        </div>
      </div>

      <SharePointSetup referenceName={connection?.rootName ?? null} referenceUrl={connection?.rootWebUrl ?? null} />

      {!!rows.length && (
        <div className="table-wrap">
          <div className="card-head"><h2 className="block-title">Últimas entregas</h2></div>
          <table className="tbl">
            <tbody>
              {rows.map((row) => {
                const establishment = Array.isArray(row.xml_watch_establishments) ? row.xml_watch_establishments[0] : row.xml_watch_establishments;
                return (
                  <tr key={row.id}>
                    <td className="cell-title">{establishment?.razao_social ?? "—"}</td>
                    <td className="muted">{documentLabel(row.tipo_documento)} · {roleLabel(row.papel)}</td>
                    <td className="muted tabular">{new Date(row.updated_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="actions"><span className="pill">{row.sharepoint_item_id ? "Envio direto" : "Pasta do PC"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details className="card disclosure">
        <summary>Avançado: envio direto pelo servidor</summary>
        <div className="disclosure-body">
          <p className="mb-3 text-[13px] text-[var(--text-2)]">Precisa da aprovação do administrador do Microsoft 365. Dispensa o atalho em cada PC.</p>
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
