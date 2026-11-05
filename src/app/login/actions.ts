"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { PORTAL_URL } from "@/lib/auth/portal";

/** Só em desenvolvimento: em produção o login é o do portal (ver lib/auth/portal.ts). */
export async function officeLogin(formData: FormData) {
  const client = await createClient();
  if (!client) redirect("/login?error=configuration");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const requestHeaders = await headers();
  const source = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  try { assertRateLimit(`office-login:${source}:${email}`, 5, 60_000); }
  catch { redirect("/login?error=rate_limited"); }
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) redirect("/login?error=invalid_credentials");
  const { data: memberships } = await client.from("memberships").select("role,active").eq("user_id", data.user.id).eq("active", true);
  if (!memberships?.some((item) => item.role === "SUPER_ADMIN" || item.role === "OFFICE_STAFF")) {
    await client.auth.signOut({ scope: "local" });
    redirect("/login?error=invalid_credentials");
  }
  redirect("/");
}

export async function officeLogout() {
  const client = await createClient();
  if (client) await client.auth.signOut({ scope: "local" });
  redirect(PORTAL_URL ? `${PORTAL_URL}/login` : "/login");
}
