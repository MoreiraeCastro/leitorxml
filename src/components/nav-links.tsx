"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/painel", label: "Início", match: ["/painel", "/pedidos"] },
  { href: "/estabelecimentos", label: "Empresas", match: ["/estabelecimentos", "/extracao"] },
  { href: "/conexoes", label: "Conexões", match: ["/conexoes", "/extensao", "/sharepoint"] },
  { href: "/ajuda", label: "Ajuda", match: ["/ajuda", "/guia"] },
];

export function NavLinks() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="flex items-center gap-1 text-sm" aria-label="Principal">
      {ITEMS.map((item) => {
        const active = item.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 transition-colors ${active ? "bg-[#082240] font-medium text-white" : "text-black/60 hover:bg-black/5 hover:text-black"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
