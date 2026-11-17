import { redirect } from "next/navigation";
import { PORTAL_URL, portalLoginUrl } from "@/lib/auth/portal";
import { officeLogin } from "./actions";
import { PasswordInput } from "@/components/password-input";

export const metadata = { title: "Entrar" };
const errors: Record<string, string> = {
  invalid_credentials: "Email ou senha inválidos.",
  rate_limited: "Muitas tentativas. Aguarde um minuto e tente novamente.",
  configuration: "O acesso está temporariamente indisponível.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // Login único: em produção a equipe entra pelo login do portal.
  if (PORTAL_URL) redirect(portalLoginUrl());
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--canvas)] p-6">
      <section className="card w-full max-w-sm p-8">
        <span className="app-mark" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 14l2 2 4-4" /></svg>
        </span>
        <h1 className="page-title mt-4">Leitor de XML</h1>
        <p className="page-sub">Acesso da equipe Moreira &amp; Castro.</p>
        {error && errors[error] && (
          <p role="alert" className="callout callout-danger mt-4">{errors[error]}</p>
        )}
        <form action={officeLogin} className="mt-6 flex flex-col gap-4">
          <div className="field">
            <label htmlFor="email" className="label">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required className="input" />
          </div>
          <div className="field">
            <label htmlFor="password" className="label">Senha</label>
            <PasswordInput id="password" name="password" autoComplete="current-password" required className="input" />
          </div>
          <button type="submit" className="btn btn-block mt-2">Entrar</button>
        </form>
      </section>
    </main>
  );
}
