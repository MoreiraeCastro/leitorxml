import Link from "next/link";
import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { PageHeader, Shell } from "@/components/shell";
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
      <PageHeader title="Conexões" subtitle="Como a extensão do Chrome e o SharePoint se ligam ao Leitor de XML." />
      <div className="tabs -mt-2" role="tablist">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/conexoes?aba=${tab.key}`}
            role="tab"
            aria-selected={tab.key === current}
            title={tab.hint}
            className="tab"
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <div className="mt-6">{current === "sharepoint" ? <SharePointSection /> : <ExtensaoSection />}</div>
    </Shell>
  );
}
