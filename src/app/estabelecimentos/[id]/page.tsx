import { notFound } from "next/navigation";
import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader, Shell } from "@/components/shell";
import { EstablishmentForm } from "@/components/establishment-form";
import { atualizarEstabelecimento } from "../actions";

export const metadata = { title: "Editar estabelecimento" };

export default async function EditarEstabelecimentoPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOfficeSessionOrRedirect();
  const { id } = await params;
  const { data: establishment } = await createAdminClient()
    .from("xml_watch_establishments")
    .select("id,cnpj,razao_social,inscricao_estadual,codigo_dominio,responsavel,sharepoint_folder_path,situacao_cadastral,certificado_tipo,procuracao_grupo,procuracao_posicao,ativo")
    .eq("id", id)
    .maybeSingle();
  if (!establishment) notFound();

  return (
    <Shell session={session}>
      <PageHeader back={{ href: "/estabelecimentos", label: "Empresas" }} title={establishment.razao_social} subtitle={<span className="tabular">CNPJ {establishment.cnpj}</span>} />
      <EstablishmentForm
        action={atualizarEstabelecimento.bind(null, id)}
        showAtivo
        defaults={{
          cnpj: establishment.cnpj,
          razaoSocial: establishment.razao_social,
          inscricaoEstadual: establishment.inscricao_estadual,
          codigoDominio: establishment.codigo_dominio,
          responsavel: establishment.responsavel,
          sharepointFolderPath: establishment.sharepoint_folder_path,
          situacaoCadastral: establishment.situacao_cadastral,
          certificadoTipo: establishment.certificado_tipo,
          procuracaoGrupo: establishment.procuracao_grupo,
          procuracaoPosicao: establishment.procuracao_posicao,
          ativo: establishment.ativo,
        }}
      />
    </Shell>
  );
}
