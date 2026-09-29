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
    <div className="rounded border border-black/10 bg-white p-4">
      <form action={formAction} className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="label" className="block text-xs text-black/50">Rótulo (opcional, ex.: &quot;notebook Paulo&quot;)</label>
          <input id="label" name="label" maxLength={120} className="mt-1 w-full rounded border border-black/15 px-2 py-1 text-sm" />
        </div>
        <button type="submit" disabled={pending} className="rounded bg-[#082240] px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {pending ? "Gerando…" : "Gerar novo token"}
        </button>
      </form>

      {state.error && <p className="mt-3 text-sm text-red-700">{state.error}</p>}

      {state.token && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-800">
            Copie agora — esse valor só aparece uma vez. Cole em &quot;Token&quot; no popup da extensão.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input readOnly value={state.token} className="flex-1 rounded border border-amber-300 bg-white px-2 py-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={copyToken} className="rounded border border-amber-400 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100">
              {copied ? "Copiado!" : "Copiar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
