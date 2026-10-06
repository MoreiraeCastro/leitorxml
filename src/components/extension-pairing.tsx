"use client";
import { useCallback, useEffect, useState } from "react";
import { parearExtensao } from "@/app/extensao/actions";
import { withBasePath } from "@/lib/base-path";

type Estado = "verificando" | "nao-detectada" | "pronta" | "conectando" | "conectada" | "erro";

/**
 * Liga a extensão a este portal sem ninguém copiar token: o servidor gera um token novo (o antigo de pareamento é
 * revogado), esta página o entrega à extensão por postMessage (mesma origem) e ele nunca é mostrado na tela.
 */
export function ExtensionPairing() {
  const [estado, setEstado] = useState<Estado>("verificando");
  const [mensagem, setMensagem] = useState<string | null>(null);

  const perguntar = useCallback(() => window.postMessage({ source: "leitorxml-portal", type: "PING" }, window.location.origin), []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== "leitorxml-extensao") return;
      if (event.data.type === "PONG") setEstado((atual) => (atual === "conectando" || atual === "conectada" ? atual : event.data.paired ? "conectada" : "pronta"));
      if (event.data.type === "PAIRED") {
        setEstado(event.data.ok ? "conectada" : "erro");
        setMensagem(event.data.ok ? null : "A extensão não aceitou a conexão.");
      }
    };
    window.addEventListener("message", onMessage);
    // A extensão pode demorar um instante pra carregar na página: pergunta algumas vezes antes de desistir.
    perguntar();
    const retry = setInterval(perguntar, 700);
    const giveUp = setTimeout(() => {
      clearInterval(retry);
      setEstado((atual) => (atual === "verificando" ? "nao-detectada" : atual));
    }, 3500);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(retry);
      clearTimeout(giveUp);
    };
  }, [perguntar]);

  async function conectar() {
    setEstado("conectando");
    setMensagem(null);
    try {
      const { token } = await parearExtensao();
      window.postMessage({ source: "leitorxml-portal", type: "PAIR", token, apiBaseUrl: `${window.location.origin}${withBasePath("")}` }, window.location.origin);
      // Se a extensão não responder em alguns segundos, avisa em vez de ficar girando.
      setTimeout(() => setEstado((atual) => (atual === "conectando" ? "erro" : atual)), 6000);
    } catch {
      setEstado("erro");
      setMensagem("Não foi possível gerar a conexão. Tente de novo.");
    }
  }

  const box = "rounded border p-4 text-sm";
  if (estado === "conectada") {
    return (
      <div className={`${box} border-emerald-200 bg-emerald-50 text-emerald-800`}>
        <p className="font-semibold">Extensão conectada neste Chrome.</p>
        <p className="mt-1">Pode fechar esta página. Não precisa copiar nada. Se trocar de computador ou de Chrome, volte aqui e conecte de novo.</p>
        <button type="button" onClick={conectar} className="mt-3 rounded border border-emerald-300 px-3 py-1 text-xs hover:bg-emerald-100">Reconectar (gera uma conexão nova)</button>
      </div>
    );
  }
  if (estado === "nao-detectada") {
    return (
      <div className={`${box} border-amber-200 bg-amber-50 text-amber-900`}>
        <p className="font-semibold">Extensão não detectada neste Chrome.</p>
        <p className="mt-1">Confira se a extensão “Leitor de XML” está instalada e ligada em <code>chrome://extensions</code>, depois recarregue esta página.</p>
      </div>
    );
  }
  return (
    <div className={`${box} border-black/10 bg-white`}>
      <p className="font-semibold text-[#082240]">Conectar a extensão a este portal</p>
      <p className="mt-1 text-black/60">Um clique. A conexão vai sozinha para a extensão, sem copiar nem colar nada.</p>
      <button type="button" onClick={conectar} disabled={estado === "verificando" || estado === "conectando"} className="mt-3 rounded bg-[#082240] px-4 py-2 text-sm font-medium text-white hover:bg-[#123a5d] disabled:opacity-50">
        {estado === "conectando" ? "Conectando…" : estado === "verificando" ? "Procurando a extensão…" : "Conectar esta extensão"}
      </button>
      {(estado === "erro" || mensagem) && <p className="mt-3 text-red-700">{mensagem ?? "A extensão não respondeu. Recarregue a página e tente de novo."}</p>}
    </div>
  );
}
