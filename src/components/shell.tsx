import Link from "next/link";
import { officeLogout } from "@/app/login/actions";
import type { OfficeSession } from "@/lib/auth/session";
import { NavLinks } from "@/components/nav-links";

export function Shell({ session, children }: { session: OfficeSession; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f4f6f4]">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- o portal fica na raiz do domínio, fora do basePath */}
            <a href="/" title="Voltar ao portal" className="-mr-2 inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-black/10 pl-2 pr-3 text-[12.5px] font-medium text-black/60 hover:bg-black/5 hover:text-black">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" /></svg>
              Portal
            </a>
            <Link href="/painel" className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#082240] text-white" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 14l2 2 4-4" /></svg>
              </span>
              <span className="text-[15px] font-semibold text-[#082240]">Leitor de XML</span>
            </Link>
            <NavLinks />
          </div>
          <div className="flex items-center gap-3 text-sm text-black/60">
            <span className="hidden sm:inline">{session.displayName}</span>
            <form action={officeLogout}><button type="submit" className="rounded-md px-2 py-1 hover:bg-black/5 hover:text-black">Sair</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
