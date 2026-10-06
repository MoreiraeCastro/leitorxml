import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell } from "@/components/shell";
import { SharePointPanel } from "@/components/sharepoint-panel";
import { getSharePointConnection, sharePointConfigured } from "@/lib/leitorxml/sharepoint";

export const metadata = { title: "SharePoint" };
export const dynamic = "force-dynamic";

export default async function SharePointPage() {
  const session = await requireOfficeSessionOrRedirect();
  const db = createAdminClient();
  const configured = sharePointConfigured();
  const connection = configured ? await getSharePointConnection(db) : null;
  const { count } = await db
    .from("xml_collection_tasks")
    .select("id", { count: "exact", head: true })
    .in("status", ["DISPONIVEL_REVISAO", "REVISADO"])
    .is("sharepoint_item_id", null)
    .not("storage_path_zip", "is", null);

  return (
    <Shell session={session}>
      <h1 className="text-lg font-semibold text-[#082240]">SharePoint</h1>
      <p className="mt-1 mb-4 text-sm text-black/60">Destino final dos ZIPs baixados do Fisco Fácil.</p>
      <SharePointPanel
        configured={configured}
        connected={Boolean(connection?.hasRefreshToken)}
        account={connection?.account ?? null}
        hasRoot={Boolean(connection?.hasRootFolder)}
        rootName={connection?.rootName ?? null}
        rootWebUrl={connection?.rootWebUrl ?? null}
        pendingCount={count ?? 0}
      />
    </Shell>
  );
}
