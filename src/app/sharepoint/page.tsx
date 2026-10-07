import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell } from "@/components/shell";
import { SharePointPanel } from "@/components/sharepoint-panel";
import { SharePointSetup } from "@/components/sharepoint-setup";
import { getSharePointConnection, sharePointConfigured } from "@/lib/leitorxml/sharepoint";
import { documentLabel, roleLabel } from "@/lib/leitorxml/status-labels";

export const metadata = { title: "SharePoint" };
export const dynamic = "force-dynamic";

const IN_REVIEW = ["DISPONIVEL_REVISAO", "REVISADO"];

type Delivered = {
  id: string;
  tipo_documento: "NFE" | "NFCE";
  papel: "EMITENTE" | "DESTINATARIO";
  sharepoint_path: string | null;
  sharepoint_item_id: string | null;
  updated_at: string;
  xml_watch_establishments: { razao_social: string } | { razao_social: string }[] | null;
};

export default async function SharePointPage() {
  const session = await requireOfficeSessionOrRedirect();
  const db = createAdminClient();
  const configured = sharePointConfigured();
  const connection = await getSharePointConnection(db).catch(() => null);

  // "Pendente" = ZIP validado em staging que ainda não chegou ao SharePoint por NENHUM caminho (pasta do PC ou envio direto).
  const { count: pendentes } = await db.from("xml_collection_tasks").select("id", { count: "exact", head: true })
    .in("status", IN_REVIEW).is("sharepoint_path", null).is("sharepoint_item_id", null).not("storage_path_zip", "is", null);
  const { count: entregues } = await db.from("xml_collection_tasks").select("id", { count: "exact", head: true })
    .or("sharepoint_path.not.is.null,sharepoint_item_id.not.is.null");
  const { data: recentes } = await db
    .from("xml_collection_tasks")
    .select("id,tipo_documento,papel,sharepoint_path,sharepoint_item_id,updated_at,xml_watch_establishments(razao_social)")
    .or("sharepoint_path.not.is.null,sharepoint_item_id.not.is.null")
    .order("updated_at", { ascending: false })
    .limit(8);
  const rows = (recentes as Delivered[] | null) ?? [];

  return (
    <Shell session={session}>
      <h1 className="text-lg font-semibold text-[#082240]">SharePoint</h1>
      <p className="mt-1 mb-4 text-sm text-black/60">Destino final dos ZIPs baixados do Fisco Fácil. A extensão salva cada arquivo na pasta do SharePoint do computador, e o OneDrive sobe para a nuvem.</p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded border border-black/10 bg-white px-4 py-3">
          <div className="text-2xl font-semibold text-[#082240]">{entregues ?? 0}</div>
          <div className="text-xs text-black/50">entregues na pasta</div>
        </div>
        <div className={`rounded border px-4 py-3 ${(pendentes ?? 0) > 0 ? "border-amber-200 bg-amber-50" : "border-black/10 bg-white"}`}>
          <div className="text-2xl font-semibold text-[#082240]">{pendentes ?? 0}</div>
          <div className="text-xs text-black/50">aguardando entrega</div>
        </div>
      </div>
      {(pendentes ?? 0) > 0 && (
        <p className="mb-4 text-sm text-black/60">Os que aguardam são entregues sozinhos assim que a extensão (com o interruptor ligado) estiver aberta em um PC configurado.</p>
      )}

      <SharePointSetup referenceName={connection?.rootName ?? null} referenceUrl={connection?.rootWebUrl ?? null} />

      <section className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black/50">Últimas entregas</h2>
        {!rows.length && <p className="mt-3 text-sm text-black/50">Nenhuma entrega registrada ainda.</p>}
        {!!rows.length && (
          <div className="mt-3 overflow-x-auto rounded border border-black/10 bg-white">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
                  <th className="px-4 py-2">Empresa</th>
                  <th className="px-4 py-2">Documento</th>
                  <th className="px-4 py-2">Entregue em</th>
                  <th className="px-4 py-2">Como</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const establishment = Array.isArray(row.xml_watch_establishments) ? row.xml_watch_establishments[0] : row.xml_watch_establishments;
                  return (
                    <tr key={row.id} className="border-b border-black/5 last:border-0">
                      <td className="px-4 py-2">{establishment?.razao_social ?? "—"}</td>
                      <td className="px-4 py-2">{documentLabel(row.tipo_documento)} · {roleLabel(row.papel)}</td>
                      <td className="px-4 py-2 text-black/60">{new Date(row.updated_at).toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-2 text-black/60">{row.sharepoint_item_id ? "Envio direto" : "Pasta do PC"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="mt-8 rounded border border-black/10 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[#082240]">Avançado: envio direto pelo servidor (precisa da aprovação do administrador)</summary>
        <div className="px-4 pb-4">
          <p className="mb-3 text-sm text-black/60">Alternativa à pasta do PC: o próprio servidor grava na biblioteca com a conta Microsoft conectada. Só funciona depois que o administrador do Microsoft 365 aprovar o aplicativo “Leitor de XML”.</p>
          <SharePointPanel
            configured={configured}
            connected={Boolean(connection?.hasRefreshToken)}
            account={connection?.account ?? null}
            hasRoot={Boolean(connection?.hasRootFolder)}
            rootName={connection?.rootName ?? null}
            rootWebUrl={connection?.rootWebUrl ?? null}
            pendingCount={pendentes ?? 0}
          />
        </div>
      </details>
    </Shell>
  );
}
