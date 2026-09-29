import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Trimmed do session.ts do fiscalmc-latest: leitorxml é staff-only (sem
// CLIENT_USER, sem contexto de organização) — só o que OFFICE precisa.

type AuthenticatedUser = { id: string; email: string | null; displayName: string };

function optionalClaimString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const getAuthenticatedClient = cache(async () => {
  const client = await createClient();
  if (!client) return { client: null, user: null };
  const { data, error } = await client.auth.getClaims();
  const claims = data?.claims;
  const id = optionalClaimString(claims?.sub);
  if (error || !id) return { client, user: null };
  const email = optionalClaimString(claims?.email);
  const metadata = claims?.user_metadata;
  const fullName = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? optionalClaimString((metadata as Record<string, unknown>).full_name)
    : null;
  const user: AuthenticatedUser = { id, email, displayName: fullName ?? email ?? "Usuário" };
  return { client, user };
});

const getActiveMemberships = cache(async (userId: string) => {
  const { client } = await getAuthenticatedClient();
  if (!client) return { data: null, error: new Error("AUTH_CONFIGURATION_REQUIRED") };
  return client.from("memberships").select("organization_id,role").eq("user_id", userId).eq("active", true);
});

export type OfficeSession = { userId: string; role: "SUPER_ADMIN" | "OFFICE_STAFF"; displayName: string };

export async function requireOfficeSession(): Promise<OfficeSession> {
  const { client, user } = await getAuthenticatedClient();
  if (!client) throw new Error("AUTH_CONFIGURATION_REQUIRED");
  if (!user) throw new Error("UNAUTHENTICATED");
  const { data: memberships, error } = await getActiveMemberships(user.id);
  const officeMemberships = memberships?.filter((item) => item.role === "SUPER_ADMIN" || item.role === "OFFICE_STAFF");
  if (error || !officeMemberships?.length) throw new Error("FORBIDDEN_OFFICE");
  return { userId: user.id, role: officeMemberships.some((item) => item.role === "SUPER_ADMIN") ? "SUPER_ADMIN" : "OFFICE_STAFF", displayName: user.displayName };
}

/** Server Components redirecionam visitantes não autenticados; rotas de API mantêm respostas de erro HTTP. */
export async function requireOfficeSessionOrRedirect(): Promise<OfficeSession> {
  try { return await requireOfficeSession(); } catch { redirect("/login"); }
}

/**
 * Client escopado ao JWT do usuário autenticado. Use para leituras OFFICE de
 * rotina, para que a RLS do banco continue sendo o limite de autorização.
 * Operações que exigem elevação de fato continuam usando createAdminClient
 * explicitamente no lib.
 */
export async function requireOfficeDataClient() {
  await requireOfficeSession();
  const { client } = await getAuthenticatedClient();
  if (!client) throw new Error("AUTH_CONFIGURATION_REQUIRED");
  return client;
}
