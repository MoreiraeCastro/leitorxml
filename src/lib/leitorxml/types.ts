export type XmlWatchCertificateType = "ESCRITORIO_PROCURACAO" | "PROPRIO";
export type XmlCollectionDocumentType = "NFE" | "NFCE";
export type XmlCollectionRole = "EMITENTE" | "DESTINATARIO";
export type XmlCollectionFileValidation = "OK" | "QUARENTENA" | "REJEITADO";

export type XmlCollectionStatus =
  | "AGENDADA" | "NA_FILA" | "AUTENTICANDO" | "SELECIONANDO_CONTEXTO" | "SOLICITADO"
  | "PROCESSANDO_SEFAZ" | "SEM_DOCUMENTOS" | "PRONTO_PARA_BAIXAR" | "BAIXANDO" | "VALIDANDO"
  | "SALVANDO_SHAREPOINT" | "DISPONIVEL_REVISAO" | "REVISADO" | "EXPIRADA" | "FALHA" | "AGUARDANDO_INTERVENCAO";

/** As 3 combinações mapeadas na Descoberta — NFC-e só existe como Emitente. */
export const XML_COLLECTION_DOCUMENT_COMBINATIONS: ReadonlyArray<{ tipoDocumento: XmlCollectionDocumentType; papel: XmlCollectionRole }> = [
  { tipoDocumento: "NFE", papel: "EMITENTE" },
  { tipoDocumento: "NFE", papel: "DESTINATARIO" },
  { tipoDocumento: "NFCE", papel: "EMITENTE" },
];

export type XmlWatchEstablishment = {
  id: string;
  cnpj: string;
  razaoSocial: string;
  situacaoCadastral: string | null;
  ativo: boolean;
  certificadoTipo: XmlWatchCertificateType;
  procuracaoGrupo: string | null;
  procuracaoPosicao: number | null;
  lockedByUserId: string | null;
  lockedAt: string | null;
};

export type XmlCollectionTask = {
  id: string;
  establishmentId: string;
  competenciaAno: number;
  competenciaMes: number;
  tipoDocumento: XmlCollectionDocumentType;
  papel: XmlCollectionRole;
  status: XmlCollectionStatus;
  sefazReferencia: string | null;
  tentativas: number;
};
