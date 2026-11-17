import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { PageHeader, Shell } from "@/components/shell";
import { EstablishmentForm } from "@/components/establishment-form";
import { criarEstabelecimento } from "../actions";

export const metadata = { title: "Novo estabelecimento" };

export default async function NovoEstabelecimentoPage() {
  const session = await requireOfficeSessionOrRedirect();
  return (
    <Shell session={session}>
      <PageHeader back={{ href: "/estabelecimentos", label: "Empresas" }} title="Novo estabelecimento" subtitle="Dados da empresa e do certificado usado na coleta." />
      <EstablishmentForm action={criarEstabelecimento} />
    </Shell>
  );
}
