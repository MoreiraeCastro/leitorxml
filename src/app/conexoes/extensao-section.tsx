import Link from "next/link";
import { requireOfficeDataClient } from "@/lib/auth/session";
import { withBasePath } from "@/lib/base-path";
import { ExtensionTokenGenerator } from "@/components/extension-token-generator";
import { ExtensionPairing } from "@/components/extension-pairing";
import { revogarToken } from "../extensao/actions";

type TokenRow = { id: string; label: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null };
const fmt = (value: string | null) => (value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Nunca");

export async function ExtensaoSection() {
  const db = await requireOfficeDataClient();
  const { data: tokens } = await db.from("xml_leitor_extension_tokens").select("id,label,created_at,last_used_at,revoked_at").order("created_at", { ascending: false });
  const rows = (tokens as TokenRow[] | null) ?? [];
  const active = rows.filter((row) => !row.revoked_at);

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-5 py-4">
        <div>
          <h2 className="font-medium text-[#082240]">Instalar em outro computador</h2>
          <p className="text-sm text-black/60">Baixe o instalador, abra e siga a janela. Passo a passo em <Link href="/ajuda" className="underline">Ajuda → Instalar a extensão</Link>.</p>
          <a href={withBasePath("/api/leitorxml/extensao/pacote")} className="text-xs text-black/50 underline">Prefere o ZIP, para instalar manualmente?</a>
        </div>
        <a href={withBasePath("/api/leitorxml/extensao/instalador")} className="rounded-lg bg-[#082240] px-4 py-2 text-sm font-medium text-white hover:opacity-90">Baixar o instalador</a>
      </section>

      <ExtensionPairing />

      <details className="rounded-xl border border-black/10 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-[#082240]">Conexões ativas ({active.length})</summary>
        <div className="overflow-x-auto px-5 pb-4">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-black/50">
                <th className="py-2 pr-4 font-medium">Nome</th>
                <th className="py-2 pr-4 font-medium">Criada</th>
                <th className="py-2 pr-4 font-medium">Último uso</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {!active.length && <tr><td colSpan={4} className="py-4 text-black/50">Nenhuma conexão ativa.</td></tr>}
              {active.map((row) => (
                <tr key={row.id} className="border-b border-black/5 last:border-0">
                  <td className="py-2 pr-4">{row.label ?? "Token manual"}</td>
                  <td className="py-2 pr-4 text-black/60">{fmt(row.created_at)}</td>
                  <td className="py-2 pr-4 text-black/60">{fmt(row.last_used_at)}</td>
                  <td className="py-2 text-right">
                    <form action={revogarToken}>
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" className="text-xs text-red-700 hover:underline">Revogar</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="rounded-xl border border-black/10 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-[#082240]">Avançado: gerar token manual</summary>
        <div className="px-5 pb-4">
          <p className="mb-3 text-sm text-black/60">Só para outros usos da API. Aparece uma única vez.</p>
          <ExtensionTokenGenerator />
        </div>
      </details>
    </div>
  );
}
