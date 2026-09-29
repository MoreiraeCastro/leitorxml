"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOfficeSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

const baseSchema = z.object({
  cnpj: z.string().trim().regex(/^\d{14}$/, "CNPJ deve ter 14 dígitos, só números."),
  razaoSocial: z.string().trim().min(2).max(250),
  inscricaoEstadual: z.string().trim().max(30).optional(),
  codigoDominio: z.string().trim().max(50).optional(),
  responsavel: z.string().trim().max(120).optional(),
  sharepointFolderPath: z.string().trim().max(500).optional(),
  situacaoCadastral: z.string().trim().max(60).optional(),
  certificadoTipo: z.enum(["ESCRITORIO_PROCURACAO", "PROPRIO"]),
  procuracaoGrupo: z.string().trim().max(120).optional(),
  procuracaoPosicao: z.coerce.number().int().positive().optional(),
});

function parseForm(formData: FormData) {
  const parsed = baseSchema.parse({
    cnpj: formData.get("cnpj"),
    razaoSocial: formData.get("razaoSocial"),
    inscricaoEstadual: formData.get("inscricaoEstadual") || undefined,
    codigoDominio: formData.get("codigoDominio") || undefined,
    responsavel: formData.get("responsavel") || undefined,
    sharepointFolderPath: formData.get("sharepointFolderPath") || undefined,
    situacaoCadastral: formData.get("situacaoCadastral") || undefined,
    certificadoTipo: formData.get("certificadoTipo"),
    procuracaoGrupo: formData.get("procuracaoGrupo") || undefined,
    procuracaoPosicao: formData.get("procuracaoPosicao") || undefined,
  });
  if (parsed.certificadoTipo === "ESCRITORIO_PROCURACAO" && !parsed.procuracaoGrupo) {
    throw new Error("Informe o grupo de procuração para certificado do escritório.");
  }
  return parsed;
}

export async function criarEstabelecimento(formData: FormData) {
  const session = await requireOfficeSession();
  const input = parseForm(formData);
  const db = createAdminClient();
  const { data, error } = await db.from("xml_watch_establishments").insert({
    cnpj: input.cnpj,
    razao_social: input.razaoSocial,
    inscricao_estadual: input.inscricaoEstadual ?? null,
    codigo_dominio: input.codigoDominio ?? null,
    responsavel: input.responsavel ?? null,
    sharepoint_folder_path: input.sharepointFolderPath ?? null,
    situacao_cadastral: input.situacaoCadastral ?? null,
    certificado_tipo: input.certificadoTipo,
    procuracao_grupo: input.certificadoTipo === "ESCRITORIO_PROCURACAO" ? input.procuracaoGrupo : null,
    procuracao_posicao: input.certificadoTipo === "ESCRITORIO_PROCURACAO" ? (input.procuracaoPosicao ?? null) : null,
  }).select("id").single();
  if (error || !data) throw new Error("Não foi possível cadastrar o estabelecimento — confira se o CNPJ já existe.");
  await db.from("audit_logs").insert({ actor_user_id: session.userId, organization_id: null, actor_type: "OFFICE", action: "leitorxml_establishment_created", entity: "xml_watch_establishment", entity_id: data.id, safe_metadata: { cnpj: input.cnpj } });
  redirect("/estabelecimentos");
}

export async function atualizarEstabelecimento(id: string, formData: FormData) {
  const session = await requireOfficeSession();
  const input = parseForm(formData);
  const ativo = formData.get("ativo") === "on";
  const db = createAdminClient();
  const { error } = await db.from("xml_watch_establishments").update({
    razao_social: input.razaoSocial,
    inscricao_estadual: input.inscricaoEstadual ?? null,
    codigo_dominio: input.codigoDominio ?? null,
    responsavel: input.responsavel ?? null,
    sharepoint_folder_path: input.sharepointFolderPath ?? null,
    situacao_cadastral: input.situacaoCadastral ?? null,
    certificado_tipo: input.certificadoTipo,
    procuracao_grupo: input.certificadoTipo === "ESCRITORIO_PROCURACAO" ? input.procuracaoGrupo : null,
    procuracao_posicao: input.certificadoTipo === "ESCRITORIO_PROCURACAO" ? (input.procuracaoPosicao ?? null) : null,
    ativo,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error("Não foi possível atualizar o estabelecimento.");
  await db.from("audit_logs").insert({ actor_user_id: session.userId, organization_id: null, actor_type: "OFFICE", action: "leitorxml_establishment_updated", entity: "xml_watch_establishment", entity_id: id, safe_metadata: {} });
  redirect("/estabelecimentos");
}
