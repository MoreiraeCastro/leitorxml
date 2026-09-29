import { officeLogin } from "./actions";

export const metadata = { title: "Entrar" };
const errors: Record<string, string> = {
  invalid_credentials: "Email ou senha inválidos.",
  rate_limited: "Muitas tentativas. Aguarde um minuto e tente novamente.",
  configuration: "O acesso está temporariamente indisponível.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f6f4] p-6">
      <section className="w-full max-w-sm rounded-lg border border-black/10 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-[#082240]">Leitor de XML</h1>
        <p className="mt-1 text-sm text-black/60">Acesso da equipe Moreira &amp; Castro.</p>
        {error && errors[error] && (
          <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errors[error]}</p>
        )}
        <form action={officeLogin} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium text-black/80">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required className="rounded border border-black/15 px-3 py-2 text-sm outline-none focus:border-[#082240]" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium text-black/80">Senha</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className="rounded border border-black/15 px-3 py-2 text-sm outline-none focus:border-[#082240]" />
          </div>
          <button type="submit" className="mt-2 rounded bg-[#082240] px-3 py-2 text-sm font-medium text-white hover:bg-[#123a5d]">Entrar</button>
        </form>
      </section>
    </main>
  );
}
