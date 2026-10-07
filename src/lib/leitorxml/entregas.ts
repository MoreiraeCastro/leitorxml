import { deliveryPath } from "./sharepoint-path";

export type DeliveryEstablishment = { cnpj: string; razao_social: string; sharepoint_folder_path: string | null };

export const DELIVERY_SELECT = "id,tipo_documento,papel,competencia_ano,competencia_mes,xml_watch_establishments(cnpj,razao_social,sharepoint_folder_path)";

type DeliveryRow = {
  id: unknown;
  tipo_documento: unknown;
  papel: unknown;
  competencia_ano: unknown;
  competencia_mes: unknown;
  xml_watch_establishments: DeliveryEstablishment | DeliveryEstablishment[] | null;
};

/** Converte as linhas de tarefa na lista `{ taskId, path }` que a extensão usa para salvar cada ZIP na pasta certa (mesma estrutura do SharePoint). */
export function toDeliveryItems(rows: DeliveryRow[]) {
  return rows.flatMap((row) => {
    const raw = row.xml_watch_establishments;
    const establishment = Array.isArray(raw) ? raw[0] : raw;
    if (!establishment) return [];
    return [{
      taskId: row.id as string,
      path: deliveryPath({
        cnpj: establishment.cnpj, razaoSocial: establishment.razao_social, folderPath: establishment.sharepoint_folder_path,
        tipo: row.tipo_documento as string, papel: row.papel as string, ano: row.competencia_ano as number, mes: row.competencia_mes as number,
      }),
    }];
  });
}
