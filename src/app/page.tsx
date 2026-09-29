import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { officeLogout } from "./login/actions";

export default async function HomePage() {
  const session = await requireOfficeSessionOrRedirect();
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <header className="flex items-center justify-between border-b border-black/10 pb-4">
        <h1 className="text-xl font-semibold text-[#082240]">Leitor de XML</h1>
        <form action={officeLogout}><button type="submit" className="text-sm text-black/60 hover:text-black">Sair</button></form>
      </header>
      <p className="mt-6 text-sm text-black/70">
        Olá, <b>{session.displayName}</b> ({session.role === "SUPER_ADMIN" ? "administrador" : "equipe"}). O backend de coleta de XML do Fisco Fácil está pronto e em produção interna.
        As telas de painel mensal, cadastro de estabelecimentos e conferência ainda estão em construção.
      </p>
    </main>
  );
}
