import Link from "next/link";
import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmptyState, PageHeader, Shell } from "@/components/shell";

export const metadata = { title: "Empresas" };

export default async function EstabelecimentosPage() {
  const session = await requireOfficeSessionOrRedirect();
  const { data: establishments, error } = await createAdminClient()
    .from("xml_watch_establishments")
    .select("id,cnpj,razao_social,situacao_cadastral,certificado_tipo,ativo")
    .order("razao_social");

  return (
    <Shell session={session}>
      <PageHeader
        title="Empresas"
        subtitle="Estabelecimentos acompanhados na coleta mensal de XML."
        actions={<Link href="/estabelecimentos/novo" className="btn">Nova empresa</Link>}
      />

      {error && <p role="alert" className="callout callout-danger">Não foi possível carregar os estabelecimentos.</p>}
      {!error && !establishments?.length && (
        <div className="card">
          <EmptyState
            title="Nenhuma empresa cadastrada ainda"
            text="Cadastre a primeira empresa para que ela entre na rotina mensal."
            action={<Link href="/estabelecimentos/novo" className="btn">Nova empresa</Link>}
          />
        </div>
      )}

      {!!establishments?.length && (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Razão social</th>
                <th>CNPJ</th>
                <th>Certificado</th>
                <th>Situação cadastral</th>
                <th>Ativo</th>
              </tr>
            </thead>
            <tbody>
              {establishments.map((establishment) => (
                <tr key={establishment.id}>
                  <td>
                    <Link href={`/estabelecimentos/${establishment.id}`} className="cell-title">{establishment.razao_social}</Link>
                  </td>
                  <td className="muted tabular">{establishment.cnpj}</td>
                  <td className="muted">{establishment.certificado_tipo === "ESCRITORIO_PROCURACAO" ? "Escritório (procuração)" : "Próprio"}</td>
                  <td className="muted">{establishment.situacao_cadastral ?? "—"}</td>
                  <td>{establishment.ativo ? <span className="pill pill-ok">Sim</span> : <span className="pill">Não</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
