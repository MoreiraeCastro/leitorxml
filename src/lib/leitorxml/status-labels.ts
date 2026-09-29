import type { XmlCollectionStatus } from "./types";

export const STATUS_LABELS: Record<XmlCollectionStatus, string> = {
  AGENDADA: "Agendada",
  NA_FILA: "Na fila",
  AUTENTICANDO: "Autenticando",
  SELECIONANDO_CONTEXTO: "Selecionando contexto",
  SOLICITADO: "Solicitado",
  PROCESSANDO_SEFAZ: "Processando na SEFAZ",
  SEM_DOCUMENTOS: "Sem documentos retornados",
  PRONTO_PARA_BAIXAR: "Pronto para baixar",
  BAIXANDO: "Baixando",
  VALIDANDO: "Validando",
  SALVANDO_SHAREPOINT: "Salvando no SharePoint",
  DISPONIVEL_REVISAO: "Disponível para revisão",
  REVISADO: "Revisado",
  EXPIRADA: "Expirada",
  FALHA: "Falha",
  AGUARDANDO_INTERVENCAO: "Aguardando intervenção",
};

export type StatusTone = "ok" | "warn" | "info" | "danger" | "neutral";

const TONE_BY_STATUS: Record<XmlCollectionStatus, StatusTone> = {
  AGENDADA: "neutral",
  NA_FILA: "neutral",
  AUTENTICANDO: "info",
  SELECIONANDO_CONTEXTO: "info",
  SOLICITADO: "info",
  PROCESSANDO_SEFAZ: "info",
  SEM_DOCUMENTOS: "neutral",
  PRONTO_PARA_BAIXAR: "warn",
  BAIXANDO: "info",
  VALIDANDO: "info",
  SALVANDO_SHAREPOINT: "info",
  DISPONIVEL_REVISAO: "warn",
  REVISADO: "ok",
  EXPIRADA: "danger",
  FALHA: "danger",
  AGUARDANDO_INTERVENCAO: "danger",
};

export function statusTone(status: XmlCollectionStatus): StatusTone {
  return TONE_BY_STATUS[status];
}

const DOCUMENT_LABELS = { NFE: "NF-e", NFCE: "NFC-e" } as const;
const ROLE_LABELS = { EMITENTE: "Emitente", DESTINATARIO: "Destinatário" } as const;

export function documentLabel(tipo: keyof typeof DOCUMENT_LABELS) { return DOCUMENT_LABELS[tipo]; }
export function roleLabel(papel: keyof typeof ROLE_LABELS) { return ROLE_LABELS[papel]; }

const MONTH_LABELS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export function competenciaLabel(ano: number, mes: number) { return `${MONTH_LABELS[mes - 1]}/${ano}`; }
