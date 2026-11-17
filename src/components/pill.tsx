import type { Phase } from "@/lib/leitorxml/inicio";

const TONE: Record<Phase, string> = {
  PEDIR: "",
  SEFAZ: "pill-warn",
  PRONTA: "pill-info",
  REVISAR: "pill-ok",
  BAIXADO: "pill-ok-strong",
  REVISADO: "pill-ok-outline",
  SEM_DOCS: "pill-faint",
  PROBLEMA: "pill-danger",
};

/** Etiqueta de status (cor = fase). Texto curto, sempre com palavra além da cor. */
export function Pill({ phase, children }: { phase: Phase; children: React.ReactNode }) {
  return <span className={`pill ${TONE[phase]}`}><span className="dot" aria-hidden="true" />{children}</span>;
}
