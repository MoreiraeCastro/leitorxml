/**
 * Lógica PURA do robô sobre a aba "Solicitações" do Fisco Fácil (sem navegador): interpretar a linha lida da
 * tabela, achar a linha de cada tarefa e classificar a situação. Portada de extension/src/content-fisco.js
 * (readSolicitacaoRows / pickRowForTask / classifyTrackedSituacao) — qualquer ajuste de regra vale nos dois lados.
 */

export type TrackedTask = {
  id: string;
  tipoDocumento: "NFE" | "NFCE";
  papel: "EMITENTE" | "DESTINATARIO";
  competenciaAno: number;
  competenciaMes: number;
  status: string;
  sefazReferencia: string | null;
};

/** O que o navegador devolve de cada linha (texto bruto das células), na ordem em que aparecem na página. */
export type RawSolicitacaoRow = { index: number; referencia: string; quandoTexto: string; situacaoTexto: string; temLink: boolean };

export type SolicitacaoRow = {
  index: number;
  referencia: string;
  tipoDocumento: "NFE" | "NFCE" | null;
  papel: "EMITENTE" | "DESTINATARIO" | null;
  periodoInicio: string | null;
  periodoFim: string | null;
  quando: number;
  situacaoTexto: string;
  temLink: boolean;
};

export type TrackedStatus = "PROCESSANDO_SEFAZ" | "EXPIRADA" | "SEM_DOCUMENTOS" | "PRONTO_PARA_BAIXAR" | "DESCONHECIDA";

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

export function interpretRow(raw: RawSolicitacaoRow): SolicitacaoRow {
  const referencia = squash(raw.referencia);
  const periodo = referencia.match(/(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/);
  const quando = raw.quandoTexto.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  return {
    index: raw.index,
    referencia,
    tipoDocumento: /NFC-e/i.test(referencia) ? "NFCE" : /NF-e/i.test(referencia) ? "NFE" : null,
    papel: /Emitente/i.test(referencia) ? "EMITENTE" : /Destinat/i.test(referencia) ? "DESTINATARIO" : null,
    periodoInicio: periodo?.[1] ?? null,
    periodoFim: periodo?.[2] ?? null,
    quando: quando ? new Date(Number(quando[3]), Number(quando[2]) - 1, Number(quando[1]), Number(quando[4] ?? 0), Number(quando[5] ?? 0)).getTime() : 0,
    situacaoTexto: squash(raw.situacaoTexto),
    temLink: raw.temLink,
  };
}

/** Período do mês inteiro da tarefa, no formato da tela (DD/MM/AAAA). */
export function expectedPeriod(task: Pick<TrackedTask, "competenciaAno" | "competenciaMes">) {
  const mes = String(task.competenciaMes).padStart(2, "0");
  const ultimoDia = String(new Date(task.competenciaAno, task.competenciaMes, 0).getDate()).padStart(2, "0");
  return { inicio: `01/${mes}/${task.competenciaAno}`, fim: `${ultimoDia}/${mes}/${task.competenciaAno}` };
}

/** Entre as linhas que batem com a tarefa (documento + participante + mês inteiro), a mais recente. */
export function pickRowForTask(rows: SolicitacaoRow[], task: TrackedTask): SolicitacaoRow | null {
  const { inicio, fim } = expectedPeriod(task);
  const matches = rows.filter((row) => row.tipoDocumento === task.tipoDocumento && row.papel === task.papel && row.periodoInicio === inicio && row.periodoFim === fim);
  return matches.sort((a, b) => b.quando - a.quando || a.index - b.index)[0] ?? null;
}

/** Situação mostrada na aba → estado da tarefa. Texto desconhecido NÃO assume "pronto": devolve DESCONHECIDA. */
export function classifySituacao(text: string): TrackedStatus {
  const normalized = text.toLowerCase();
  if (/aguardando/.test(normalized)) return "PROCESSANDO_SEFAZ";
  if (/expirad/.test(normalized)) return "EXPIRADA";
  if (/sem resultado/.test(normalized)) return "SEM_DOCUMENTOS";
  if (/com resultado|process[ao]/.test(normalized)) return "PRONTO_PARA_BAIXAR";
  return "DESCONHECIDA";
}

/** Só aceita o que parece um ZIP (assinatura "PK"): a resposta de erro do site também vem como arquivo. */
export function assertLooksLikeZip(bytes: Uint8Array) {
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const preview = new TextDecoder().decode(bytes.slice(0, 120)).replace(/\s+/g, " ");
    throw new Error(`RESPOSTA_NAO_E_ZIP (${bytes.length} bytes): "${preview}"`);
  }
}
