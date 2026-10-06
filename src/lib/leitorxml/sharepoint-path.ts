// Sem "server-only" de propósito: também é usado pelo script local scripts/sincronizar-sharepoint-local.ts.

/** Nomes de pasta/arquivo no SharePoint não aceitam \ / : * ? " < > | nem terminar em ponto ou espaço. */
export function safeSegment(value: string) {
  return value.replace(/[\\/:*?"<>|#%~]/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 120) || "sem-nome";
}

export type SharePointTarget = { cnpj: string; razaoSocial: string; folderPath: string | null; tipo: string; papel: string; ano: number; mes: number };

export function buildSharePointPath(target: SharePointTarget) {
  const companyFolder = target.folderPath?.trim()
    ? target.folderPath.split(/[\\/]+/).filter(Boolean).map(safeSegment)
    : [safeSegment(`${target.cnpj} - ${target.razaoSocial}`)];
  const competencia = `${target.ano}-${String(target.mes).padStart(2, "0")}`;
  const filename = safeSegment(`${target.cnpj}_${target.tipo}_${target.papel}_${competencia}`) + ".zip";
  return { directory: [...companyFolder, competencia], filename };
}
