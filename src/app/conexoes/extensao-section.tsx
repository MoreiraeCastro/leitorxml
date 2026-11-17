import Link from "next/link";
import { requireOfficeDataClient } from "@/lib/auth/session";
import { withBasePath } from "@/lib/base-path";
import { ExtensionTokenGenerator } from "@/components/extension-token-generator";
import { ExtensionPairing } from "@/components/extension-pairing";
import { revogarToken } from "../extensao/actions";

type TokenRow = { id: string; label: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null; ultima_versao: string | null };
const fmt = (value: string | null) => (value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Nunca");

export async function ExtensaoSection() {
  const db = await requireOfficeDataClient();
  const { data: tokens } = await db.from("xml_leitor_extension_tokens").select("id,label,created_at,last_used_at,revoked_at,ultima_versao").order("created_at", { ascending: false });
  const rows = (tokens as TokenRow[] | null) ?? [];
  const active = rows.filter((row) => !row.revoked_at);

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div>
          <h2 className="block-title">Instalar em outro computador</h2>
          {/* Sem a opção do ZIP solto: ele não traz o atualizador, e o PC ficaria sem atualização automática. */}
          <p className="mt-1 text-[13px] text-[var(--text-2)]">Baixe o instalador, abra e siga a janela. Passo a passo em <Link href="/ajuda" className="link">Ajuda → Instalar a extensão</Link>.</p>
          <p className="help mt-0.5">Depois de instalar, feche o Chrome por completo e abra de novo. Daí em diante a extensão se atualiza sozinha.</p>
        </div>
        <a href={withBasePath("/api/leitorxml/extensao/instalador")} className="btn">Baixar o instalador</a>
      </section>

      <ExtensionPairing />

      <details className="card disclosure">
        <summary>
          <span className="flex items-center gap-2">Conexões ativas <span className="pill tabular">{active.length}</span></span>
        </summary>
        <div className="overflow-x-auto border-t border-[var(--line)]">
          <table className="tbl">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Criada</th>
                <th>Versão</th>
                <th>Último uso</th>
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {!active.length && <tr className="no-hover"><td colSpan={5} className="py-6 text-center text-[var(--text-2)]">Nenhuma conexão ativa.</td></tr>}
              {active.map((row) => (
                <tr key={row.id}>
                  <td className="cell-title">{row.label ?? "Token manual"}</td>
                  <td className="muted tabular">{fmt(row.created_at)}</td>
                  <td className="muted tabular">{row.ultima_versao ?? "—"}</td>
                  <td className="muted tabular">{fmt(row.last_used_at)}</td>
                  <td className="actions">
                    <form action={revogarToken}>
                      <input type="hidden" name="id" value={row.id} />
                      <button type="submit" className="link-danger">Revogar</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="card disclosure">
        <summary>Avançado: gerar token manual</summary>
        <div className="disclosure-body">
          <p className="mb-3 text-[13px] text-[var(--text-2)]">Só para outros usos da API. Aparece uma única vez.</p>
          <ExtensionTokenGenerator />
        </div>
      </details>
    </div>
  );
}
