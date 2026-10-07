import type { Phase } from "@/lib/leitorxml/inicio";

const TONE: Record<Phase, string> = {
  PEDIR: "bg-black/5 text-black/60",
  SEFAZ: "bg-amber-50 text-amber-800",
  PRONTA: "bg-sky-50 text-sky-800",
  REVISAR: "bg-emerald-50 text-emerald-800",
  REVISADO: "border border-emerald-200 bg-white text-emerald-700",
  SEM_DOCS: "bg-black/[0.03] text-black/40",
  PROBLEMA: "bg-red-50 text-red-700",
};

/** Etiqueta de status (cor = fase). Texto curto, sempre com palavra além da cor. */
export function Pill({ phase, children }: { phase: Phase; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[phase]}`}>{children}</span>;
}
