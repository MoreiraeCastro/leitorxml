"use client";
import { useActionState, useState } from "react";
import { gerarToken, type GerarTokenState } from "@/app/extensao/actions";

const initialState: GerarTokenState = { token: null, label: null, error: null };

export function ExtensionTokenGenerator() {
  const [state, formAction, pending] = useActionState(gerarToken, initialState);
  const [copied, setCopied] = useState(false);

  async function copyToken() {
    if (!state.token) return;
    try {
      await navigator.clipboard.writeText(state.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard indisponível (ex.: contexto não seguro) — usuário copia manualmente do campo.
    }
  }

  return (
    <div>
      <form action={formAction} className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="label" className="label">Rótulo (opcional, ex.: &quot;notebook Paulo&quot;)</label>
          <input id="label" name="label" maxLength={120} className="input mt-1.5 w-full" />
        </div>
        <button type="submit" disabled={pending} className="btn h-[38px]">
          {pending ? "Gerando…" : "Gerar novo token"}
        </button>
      </form>

      {state.error && <p className="mt-3 text-[13px] text-[var(--danger)]">{state.error}</p>}

      {state.token && (
        <div className="callout callout-warn mt-4">
          <p className="text-[12.5px] font-medium">
            Copie agora — esse valor só aparece uma vez. Cole em &quot;Token&quot; no popup da extensão.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input readOnly value={state.token} className="input input-sm input-mono flex-1 !bg-white !text-[var(--ink-strong)]" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={copyToken} className="btn btn-secondary btn-sm">
              {copied ? "Copiado!" : "Copiar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
