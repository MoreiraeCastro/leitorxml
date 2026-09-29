import Link from "next/link";
import { officeLogout } from "@/app/login/actions";
import type { OfficeSession } from "@/lib/auth/session";

const NAV = [
  { href: "/painel", label: "Painel mensal" },
  { href: "/estabelecimentos", label: "Estabelecimentos" },
  { href: "/extracao/nova", label: "Nova extração" },
  { href: "/extensao", label: "Extensão" },
];

export function Shell({ session, children }: { session: OfficeSession; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f4f6f4]">
      <header className="border-b border-black/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-8">
            <Link href="/painel" className="text-base font-semibold text-[#082240]">Leitor de XML</Link>
            <nav className="flex gap-5 text-sm text-black/60">
              {NAV.map((item) => <Link key={item.href} href={item.href} className="hover:text-[#082240]">{item.label}</Link>)}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-black/60">
            <span>{session.displayName}</span>
            <form action={officeLogout}><button type="submit" className="hover:text-black">Sair</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
