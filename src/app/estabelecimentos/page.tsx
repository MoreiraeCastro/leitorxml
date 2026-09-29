import Link from "next/link";
import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell } from "@/components/shell";

export const metadata = { title: "Estabelecimentos" };

export default async function EstabelecimentosPage() {
  const session = await requireOfficeSessionOrRedirect();
  const { data: establishments, error } = await createAdminClient()
    .from("xml_watch_establishments")
    .select("id,cnpj,razao_social,situacao_cadastral,certificado_tipo,ativo")
    .order("razao_social");

  return (
    <Shell session={session}>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[#082240]">Estabelecimentos</h1>
        <Link href="/estabelecimentos/novo" className="rounded bg-[#082240] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#123a5d]">Novo estabelecimento</Link>
      </div>

      {error && <p className="mt-4 text-sm text-red-700">Não foi possível carregar os estabelecimentos.</p>}
      {!error && !establishments?.length && <p className="mt-8 text-sm text-black/60">Nenhum estabelecimento cadastrado ainda.</p>}

      {!!establishments?.length && (
        <div className="mt-6 overflow-x-auto rounded border border-black/10 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
                <th className="px-4 py-2">Razão social</th>
                <th className="px-4 py-2">CNPJ</th>
                <th className="px-4 py-2">Certificado</th>
                <th className="px-4 py-2">Situação cadastral</th>
                <th className="px-4 py-2">Ativo</th>
              </tr>
            </thead>
            <tbody>
              {establishments.map((establishment) => (
                <tr key={establishment.id} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/estabelecimentos/${establishment.id}`} className="font-medium text-[#082240] hover:underline">{establishment.razao_social}</Link>
                  </td>
                  <td className="px-4 py-2 text-black/70">{establishment.cnpj}</td>
                  <td className="px-4 py-2 text-black/70">{establishment.certificado_tipo === "ESCRITORIO_PROCURACAO" ? "Escritório (procuração)" : "Próprio"}</td>
                  <td className="px-4 py-2 text-black/70">{establishment.situacao_cadastral ?? "—"}</td>
                  <td className="px-4 py-2">{establishment.ativo ? "Sim" : "Não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
