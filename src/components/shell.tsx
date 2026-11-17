import Link from "next/link";
import { officeLogout } from "@/app/login/actions";
import type { OfficeSession } from "@/lib/auth/session";
import { NavLinks } from "@/components/nav-links";

export function Shell({ session, children }: { session: OfficeSession; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <header className="appbar">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-5">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- o portal fica na raiz do domínio, fora do basePath */}
            <a href="/" title="Voltar ao portal" className="portal-link shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" /></svg>
              Portal
            </a>
            <Link href="/painel" className="flex items-center gap-2.5">
              <span className="app-mark" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 14l2 2 4-4" /></svg>
              </span>
              <span className="text-[14px] font-semibold tracking-[-.011em] text-[var(--ink-strong)]">Leitor de XML</span>
            </Link>
            <NavLinks />
          </div>
          <div className="flex items-center gap-2 text-[13px] text-[var(--text-2)]">
            <span className="hidden sm:inline">{session.displayName}</span>
            <form action={officeLogout}><button type="submit" className="btn btn-sm btn-quiet">Sair</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}

/** Cabeçalho padrão de página: título + subtítulo curto à esquerda, ações à direita. */
export function PageHeader({ title, subtitle, actions, back }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="page-head">
      <div>
        {back && (
          <Link href={back.href} className="back-link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" /></svg>
            {back.label}
          </Link>
        )}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** Estado vazio: ícone em container de 40px, título, uma linha de instrução e, se houver, a ação. */
export function EmptyState({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true">
        {icon ?? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>}
      </span>
      <p className="empty-title">{title}</p>
      {text && <p className="empty-text">{text}</p>}
      {action}
    </div>
  );
}
