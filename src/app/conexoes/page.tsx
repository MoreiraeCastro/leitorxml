import Link from "next/link";
import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { Shell } from "@/components/shell";
import { ExtensaoSection } from "./extensao-section";
import { SharePointSection } from "./sharepoint-section";

export const metadata = { title: "Conexões" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "extensao", label: "Extensão do Chrome", hint: "Liga o Chrome ao portal" },
  { key: "sharepoint", label: "SharePoint", hint: "Onde os ZIPs são guardados" },
] as const;

export default async function ConexoesPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const session = await requireOfficeSessionOrRedirect();
  const { aba } = await searchParams;
  const current = TABS.some((tab) => tab.key === aba) ? aba : "extensao";

  return (
    <Shell session={session}>
      <h1 className="text-xl font-semibold text-[#082240]">Conexões</h1>
      <div className="mt-4 flex gap-1 border-b border-black/10" role="tablist">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/conexoes?aba=${tab.key}`}
            role="tab"
            aria-selected={tab.key === current}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab.key === current ? "border-[#082240] font-medium text-[#082240]" : "border-transparent text-black/50 hover:text-black"}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <div className="mt-5">{current === "sharepoint" ? <SharePointSection /> : <ExtensaoSection />}</div>
    </Shell>
  );
}
