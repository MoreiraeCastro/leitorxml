import "server-only";
import { randomBytes, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const TOKEN_PREFIX = "lxml_";

export function generateExtensionToken() {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashExtensionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** O token em texto puro só existe nesta resposta — o banco guarda só o hash. */
export async function createExtensionToken(db: SupabaseClient, userId: string, label?: string) {
  const token = generateExtensionToken();
  const { data, error } = await db
    .from("xml_leitor_extension_tokens")
    .insert({ user_id: userId, token_hash: hashExtensionToken(token), label: label ?? null })
    .select("id,created_at")
    .single();
  if (error) throw new Error("EXTENSION_TOKEN_CREATE_FAILED");
  return { id: data.id as string, token, createdAt: data.created_at as string };
}

export function extractBearerToken(authorizationHeader: string | null) {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1].trim() : null;
}

export type ExtensionIdentity = { userId: string; displayName: string; role: "SUPER_ADMIN" | "OFFICE_STAFF" };

/** Valida o token da extensão e confirma que quem o gerou ainda é staff ativo — token de alguém desligado/rebaixado para de funcionar mesmo sem ser revogado explicitamente. */
export async function resolveExtensionToken(db: SupabaseClient, authorizationHeader: string | null): Promise<ExtensionIdentity | null> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) return null;
  const { data: tokenRow, error } = await db
    .from("xml_leitor_extension_tokens")
    .select("id,user_id,revoked_at")
    .eq("token_hash", hashExtensionToken(token))
    .maybeSingle();
  if (error || !tokenRow || tokenRow.revoked_at) return null;
  const { data: membership, error: membershipError } = await db
    .from("memberships")
    .select("role")
    .eq("user_id", tokenRow.user_id)
    .eq("active", true)
    .in("role", ["SUPER_ADMIN", "OFFICE_STAFF"])
    .limit(1)
    .maybeSingle();
  if (membershipError || !membership) return null;
  const { data: profile } = await db.from("profiles").select("full_name").eq("user_id", tokenRow.user_id).maybeSingle();
  await db.from("xml_leitor_extension_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tokenRow.id);
  return { userId: tokenRow.user_id, displayName: profile?.full_name ?? "Colaborador", role: membership.role as "SUPER_ADMIN" | "OFFICE_STAFF" };
}
