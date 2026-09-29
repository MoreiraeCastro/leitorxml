import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOfficeSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createExtensionToken } from "@/lib/leitorxml/extension-tokens";

export const runtime = "nodejs";
const bodySchema = z.object({ label: z.string().trim().max(120).optional() });

/** O valor do token só existe nesta resposta — o colaborador cola na extensão e não consegue vê-lo de novo depois. */
export async function POST(request: Request) {
  try {
    const session = await requireOfficeSession();
    const input = bodySchema.parse(await request.json().catch(() => ({})));
    const result = await createExtensionToken(createAdminClient(), session.userId, input.label);
    await createAdminClient().from("audit_logs").insert({
      actor_user_id: session.userId,
      organization_id: null,
      actor_type: "OFFICE",
      action: "leitorxml_extension_token_created",
      entity: "xml_leitor_extension_token",
      entity_id: result.id,
      safe_metadata: { label: input.label ?? null },
    });
    return NextResponse.json({ token: result.token, id: result.id, createdAt: result.createdAt }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Revise os dados enviados." }, { status: 400 });
    if (error instanceof Error && ["UNAUTHENTICATED", "FORBIDDEN_OFFICE", "AUTH_CONFIGURATION_REQUIRED"].includes(error.message)) {
      return NextResponse.json({ error: "Acesso do escritório necessário." }, { status: 403 });
    }
    return NextResponse.json({ error: "Não foi possível gerar o token." }, { status: 500 });
  }
}
