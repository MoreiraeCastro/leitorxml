import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { Shell } from "@/components/shell";
import { EstablishmentForm } from "@/components/establishment-form";
import { criarEstabelecimento } from "../actions";

export const metadata = { title: "Novo estabelecimento" };

export default async function NovoEstabelecimentoPage() {
  const session = await requireOfficeSessionOrRedirect();
  return (
    <Shell session={session}>
      <h1 className="text-lg font-semibold text-[#082240]">Novo estabelecimento</h1>
      <EstablishmentForm action={criarEstabelecimento} />
    </Shell>
  );
}
