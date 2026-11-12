import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractBearerToken, hashExtensionToken } from "@/lib/leitorxml/extension-tokens";

export const runtime = "nodejs";

/**
 * A extensão desliga a própria conexão antiga quando é reconectada no portal: o token que chega aqui é revogado na hora,
 * em vez de ficar valendo por até 30 dias sem uso. Só revoga o próprio token (quem não tem o token não revoga nada).
 */
export async function POST(request: Request) {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) return NextResponse.json({ error: "Token ausente." }, { status: 401 });
  const { error } = await createAdminClient().from("xml_leitor_extension_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", hashExtensionToken(token)).is("revoked_at", null);
  if (error) return NextResponse.json({ error: "Não foi possível desconectar." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
