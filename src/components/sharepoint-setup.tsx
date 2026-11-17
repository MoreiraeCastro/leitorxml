"use client";
import { useActionState, useState } from "react";
import { salvarLinkPasta, type SharePointActionState } from "@/app/sharepoint/actions";

const idle: SharePointActionState = { message: null, error: null };
const card = "card card-pad";
const primary = "btn";
const DEFAULT_RELATIVE = "arquivos - Documentos\\Tecnologia\\Leitor de XML - Zips";

/** Procura a pasta sincronizada do SharePoint no perfil do usuário (o nome da pasta-raiz do OneDrive muda de PC pra PC) e cria o atalho. */
function buildCommand(relative: string) {
  const alvo = relative.replace(/"/g, "").trim() || DEFAULT_RELATIVE;
  return [
    `$alvo = Get-ChildItem $env:USERPROFILE -Directory | ForEach-Object { Join-Path $_.FullName "${alvo}" } | Where-Object { Test-Path $_ } | Select-Object -First 1;`,
    `if (-not $alvo) { throw "Pasta sincronizada não encontrada. Sincronize a biblioteca do SharePoint neste PC primeiro." };`,
    `$dest = "$env:USERPROFILE\\Downloads\\Leitor de XML"; if ((Test-Path $dest) -and -not (Get-Item $dest -Force).LinkType) { Rename-Item $dest "Leitor de XML (local)" };`,
    `New-Item -ItemType Junction -Path $dest -Target $alvo`,
  ].join(" ");
}

export function SharePointSetup({ referenceName, referenceUrl }: { referenceName: string | null; referenceUrl: string | null }) {
  const [folderState, folderAction, folderPending] = useActionState(salvarLinkPasta, idle);
  const [relative, setRelative] = useState(DEFAULT_RELATIVE);
  const [copied, setCopied] = useState(false);
  const command = buildCommand(relative);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // sem permissão de área de transferência: a pessoa seleciona e copia do quadro
    }
  }

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="block-title">1. Pasta de destino no SharePoint</h2>
        <p className="mt-1 text-[13px] text-[var(--text-2)]">Só uma referência para a equipe encontrar os arquivos. Não precisa conectar nada na Microsoft. Os ZIPs são salvos em <code>empresa / AAAA-MM / arquivo.zip</code> dentro dela.</p>
        {referenceUrl && (
          <p className="mt-2 text-[13px] text-[var(--ink)]">
            Atual: <strong>{referenceName ?? "pasta"}</strong> · <a className="link" href={referenceUrl} target="_blank" rel="noreferrer">abrir no SharePoint</a>
          </p>
        )}
        <form action={folderAction} className="mt-3 flex gap-2">
          <input name="link" placeholder="https://…sharepoint.com/sites/…" aria-label="Link da pasta no SharePoint" className="input min-w-0 flex-1" />
          <button type="submit" disabled={folderPending} className={`${primary} h-[38px]`}>{folderPending ? "Salvando…" : "Salvar link"}</button>
        </form>
        {folderState.error && <p className="mt-3 text-[13px] text-[var(--danger)]">{folderState.error}</p>}
        {folderState.message && <p className="mt-3 text-[13px] text-[var(--ok)]">{folderState.message}</p>}
      </section>

      <section className={card}>
        <h2 className="block-title">2. Só para PC com OneDrive (uma vez por PC)</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-[var(--ink)]">
          <li>Confirme que a biblioteca do SharePoint está <strong>sincronizada</strong> neste PC (OneDrive) e que a pasta de destino aparece no Explorer.</li>
          <li>Abra o <strong>PowerShell</strong> e cole o comando abaixo. Ele acha a pasta sozinho e cria o atalho <code>Downloads\Leitor de XML</code>.</li>
          <li>Na extensão: <em>Configurações avançadas → “Este PC tem OneDrive: enviar os ZIPs ao SharePoint”</em>.</li>
        </ol>
        <label htmlFor="relative" className="label mt-4">Caminho da pasta dentro do OneDrive (ajuste só se for diferente)</label>
        <input id="relative" value={relative} onChange={(event) => setRelative(event.target.value)} className="input input-mono mt-1.5 w-full" />
        <pre className="codeblock mt-3">{command}</pre>
        <button type="button" onClick={copy} className={`${primary} mt-3`}>{copied ? "Copiado!" : "Copiar comando"}</button>
        <p className="help mt-3">Se o PC já tinha a pasta comum <code>Downloads\Leitor de XML</code>, o comando a renomeia para “Leitor de XML (local)”; os ZIPs antigos continuam lá.</p>
      </section>
    </div>
  );
}
