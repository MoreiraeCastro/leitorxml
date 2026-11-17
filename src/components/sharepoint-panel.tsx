"use client";
import { useActionState, useState, useTransition } from "react";
import {
  conectarSharePoint, confirmarLoginSharePoint, definirPastaSharePoint, desconectarSharePoint, enviarPendentesSharePoint,
  type SharePointActionState,
} from "@/app/sharepoint/actions";

const idle: SharePointActionState = { message: null, error: null };
const card = "card card-pad";
const primary = "btn";
const ghost = "btn btn-secondary";

function Feedback({ state }: { state: SharePointActionState }) {
  return (
    <>
      {state.error && <p className="mt-3 text-[13px] text-[var(--danger)]">{state.error}</p>}
      {state.message && <p className="mt-3 text-[13px] text-[var(--ok)]">{state.message}</p>}
    </>
  );
}

export function SharePointPanel({ configured, connected, account, hasRoot, rootName, rootWebUrl, pendingCount }: {
  configured: boolean; connected: boolean; account: string | null; hasRoot: boolean; rootName: string | null; rootWebUrl: string | null; pendingCount: number;
}) {
  const [login, setLogin] = useState<SharePointActionState>(idle);
  const [busy, startTransition] = useTransition();
  const [folderState, folderAction, folderPending] = useActionState(definirPastaSharePoint, idle);
  const [sendState, setSendState] = useState<SharePointActionState>(idle);

  if (!configured) {
    return <p className="callout callout-warn">O servidor ainda não tem as variáveis do SharePoint (SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_TOKEN_KEY).</p>;
  }

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="block-title">1. Conta Microsoft</h2>
        {connected ? (
          <div className="mt-2 flex items-center justify-between">
            <p className="text-[13px] text-[var(--ink)]">Conectado como <strong>{account ?? "conta Microsoft"}</strong>.</p>
            <form action={desconectarSharePoint}><button type="submit" className={ghost}>Desconectar</button></form>
          </div>
        ) : (
          <>
            <p className="mt-1 text-[13px] text-[var(--text-2)]">Você autoriza uma vez; o servidor passa a gravar na biblioteca com a permissão da sua conta.</p>
            {!login.userCode && (
              <button type="button" disabled={busy} className={`${primary} mt-3`} onClick={() => startTransition(async () => setLogin(await conectarSharePoint()))}>
                {busy ? "Aguarde…" : "Conectar SharePoint"}
              </button>
            )}
            {login.userCode && (
              <div className="callout callout-info mt-3">
                <p>1. Abra <a className="link" href={login.verificationUri ?? "#"} target="_blank" rel="noreferrer">{login.verificationUri}</a></p>
                <p className="mt-1">2. Digite o código <code className="rounded-[var(--r-sm)] bg-white px-2 py-0.5 text-base font-semibold tracking-widest text-[var(--ink-strong)] shadow-[inset_0_0_0_1px_var(--line)]">{login.userCode}</code> e entre com a sua conta.</p>
                <p className="mt-1">3. Volte aqui e confirme.</p>
                <button
                  type="button"
                  disabled={busy}
                  className={`${primary} mt-3`}
                  onClick={() => startTransition(async () => {
                    const result = await confirmarLoginSharePoint();
                    setLogin(result.error || !result.message?.startsWith("Conectado") ? { ...result, userCode: login.userCode, verificationUri: login.verificationUri } : idle);
                  })}
                >
                  {busy ? "Conferindo…" : "Já autorizei"}
                </button>
              </div>
            )}
            <Feedback state={login} />
          </>
        )}
      </section>

      <section className={card}>
        <h2 className="block-title">2. Pasta de destino</h2>
        {hasRoot && (
          <p className="mt-1 text-[13px] text-[var(--ink)]">
            Atual: <strong>{rootName}</strong>{rootWebUrl && <> · <a className="link" href={rootWebUrl} target="_blank" rel="noreferrer">abrir no SharePoint</a></>}
          </p>
        )}
        <p className="mt-1 text-[13px] text-[var(--text-2)]">Cole o link da pasta (da barra de endereço, com a pasta aberta). Dentro dela o sistema cria <code>CNPJ - Razão Social / AAAA-MM / arquivo.zip</code>.</p>
        <form action={folderAction} className="mt-3 flex gap-2">
          <input name="link" disabled={!connected} placeholder="https://…sharepoint.com/sites/…" className="input min-w-0 flex-1" />
          <button type="submit" disabled={!connected || folderPending} className={`${primary} h-[38px]`}>{folderPending ? "Verificando…" : "Salvar pasta"}</button>
        </form>
        <Feedback state={folderState} />
      </section>

      <section className={card}>
        <h2 className="block-title">3. Envio</h2>
        <p className="mt-1 text-[13px] text-[var(--text-2)]">Novos ZIPs validados vão sozinhos pro SharePoint. Pendentes de envio agora: <strong>{pendingCount}</strong>.</p>
        <button type="button" disabled={busy || !connected || !hasRoot} className={`${primary} mt-3`} onClick={() => startTransition(async () => setSendState(await enviarPendentesSharePoint()))}>
          Enviar pendentes agora
        </button>
        <Feedback state={sendState} />
      </section>
    </div>
  );
}
