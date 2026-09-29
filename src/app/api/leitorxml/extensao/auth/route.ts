import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const identity = await resolveExtensionToken(createAdminClient(), request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  return NextResponse.json({ userId: identity.userId, displayName: identity.displayName, role: identity.role });
}
