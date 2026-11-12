"use server";
import { z } from "zod";
import { requireOfficeSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { revalidatePath } from "next/cache";

const labelSchema = z.string().trim().max(120).optional();

export type GerarTokenState = { token: string | null; label: string | null; error: string | null };

export async function gerarToken(_prevState: GerarTokenState, formData: FormData): Promise<GerarTokenState> {
  const session = await requireOfficeSession();
  const parsed = labelSchema.safeParse(formData.get("label") || undefined);
  if (!parsed.success) return { token: null, label: null, error: "Rótulo inválido." };
  const db = createAdminClient();
  const result = await createExtensionToken(db, session.userId, parsed.data);
  await db.from("audit_logs").insert({
    actor_user_id: session.userId,
    organization_id: null,
    actor_type: "OFFICE",
    action: "leitorxml_extension_token_created",
    entity: "xml_leitor_extension_token",
    entity_id: result.id,
    safe_metadata: { label: parsed.data ?? null },
  });
  revalidatePath("/extensao");
  return { token: result.token, label: parsed.data ?? null, error: null };
}

const PAIRING_LABEL = "Pareamento automático";

const DIA = 24 * 60 * 60 * 1000;
/** Conexão sem uso há tanto tempo é de um PC/Chrome que não usa mais a extensão (ou que já foi reconectado). */
const PARADA_DIAS = 30;

/**
 * "Conectar esta extensão": cria uma conexão nova para este Chrome, entregue à extensão pela própria página (nunca exibida).
 * Cada PC tem a sua: conectar aqui não derruba a de outro PC do mesmo usuário (casa e escritório ao mesmo tempo).
 * Só saem as conexões paradas: sem uso há 30 dias, ou criadas há mais de 1 dia e nunca usadas.
 */
export async function parearExtensao(): Promise<{ token: string }> {
  const session = await requireOfficeSession();
  const db = createAdminClient();
  const agora = Date.now();
  const base = () => db.from("xml_leitor_extension_tokens").update({ revoked_at: new Date(agora).toISOString() })
    .eq("user_id", session.userId).eq("label", PAIRING_LABEL).is("revoked_at", null);
  await base().lt("last_used_at", new Date(agora - PARADA_DIAS * DIA).toISOString());
  await base().is("last_used_at", null).lt("created_at", new Date(agora - DIA).toISOString());
  const result = await createExtensionToken(db, session.userId, PAIRING_LABEL);
  await db.from("audit_logs").insert({
    actor_user_id: session.userId,
    organization_id: null,
    actor_type: "OFFICE",
    action: "leitorxml_extension_paired",
    entity: "xml_leitor_extension_token",
    entity_id: result.id,
    safe_metadata: {},
  });
  revalidatePath("/extensao");
  return { token: result.token };
}

export async function revogarToken(formData: FormData) {
  const session = await requireOfficeSession();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Token inválido.");
  const db = createAdminClient();
  const { error } = await db
    .from("xml_leitor_extension_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", session.userId);
  if (error) throw new Error("Não foi possível revogar o token.");
  await db.from("audit_logs").insert({
    actor_user_id: session.userId,
    organization_id: null,
    actor_type: "OFFICE",
    action: "leitorxml_extension_token_revoked",
    entity: "xml_leitor_extension_token",
    entity_id: id,
    safe_metadata: {},
  });
  revalidatePath("/extensao");
}
