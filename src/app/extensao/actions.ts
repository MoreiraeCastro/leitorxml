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
