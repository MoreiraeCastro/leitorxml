import { requireOfficeSessionOrRedirect, requireOfficeDataClient } from "@/lib/auth/session";
import { Shell } from "@/components/shell";
import { ExtensionTokenGenerator } from "@/components/extension-token-generator";
import { revogarToken } from "./actions";

export const metadata = { title: "Extensão" };

type TokenRow = { id: string; label: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null };

export default async function ExtensaoPage() {
  const session = await requireOfficeSessionOrRedirect();
  const db = await requireOfficeDataClient();
  const { data: tokens } = await db
    .from("xml_leitor_extension_tokens")
    .select("id,label,created_at,last_used_at,revoked_at")
    .order("created_at", { ascending: false });
  const rows = (tokens as TokenRow[] | null) ?? [];

  return (
    <Shell session={session}>
      <h1 className="text-lg font-semibold text-[#082240]">Extensão — tokens de acesso</h1>
      <p className="mt-1 text-sm text-black/60">
        Cada token autentica a extensão Chrome como você. Gere um por máquina/colaborador e cole em &quot;Token&quot; no popup da extensão.
      </p>

      <div className="mt-4">
        <ExtensionTokenGenerator />
      </div>

      <div className="mt-6 overflow-x-auto rounded border border-black/10 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/10 bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
              <th className="px-4 py-2">Rótulo</th>
              <th className="px-4 py-2">Criado em</th>
              <th className="px-4 py-2">Último uso</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-black/50">Nenhum token gerado ainda.</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-black/5 last:border-0">
                <td className="px-4 py-2">{row.label ?? "—"}</td>
                <td className="px-4 py-2 text-black/60">{new Date(row.created_at).toLocaleString("pt-BR")}</td>
                <td className="px-4 py-2 text-black/60">{row.last_used_at ? new Date(row.last_used_at).toLocaleString("pt-BR") : "Nunca"}</td>
                <td className="px-4 py-2">
                  {row.revoked_at
                    ? <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-black/60">Revogado</span>
                    : <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Ativo</span>}
                </td>
                <td className="px-4 py-2 text-right">
                  {!row.revoked_at && (
                    <form action={revogarToken}>
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" className="text-xs text-red-700 hover:underline">Revogar</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
