import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveExtensionToken } from "@/lib/leitorxml/extension-tokens";
import { claimNextTrackingBatch } from "@/lib/leitorxml/tasks";

export const runtime = "nodejs";

/** Próxima empresa com solicitações já feitas (SOLICITADO / PROCESSANDO_SEFAZ) para a extensão conferir na aba Solicitações e baixar o que estiver pronto. */
export async function GET(request: Request) {
  const db = createAdminClient();
  const identity = await resolveExtensionToken(db, request.headers.get("authorization"));
  if (!identity) return NextResponse.json({ error: "Token inválido ou revogado." }, { status: 401 });
  try {
    const exclude = (new URL(request.url).searchParams.get("exclude") ?? "")
      .split(",")
      .filter((value) => z.string().uuid().safeParse(value).success);
    const only = z.string().uuid().safeParse(new URL(request.url).searchParams.get("establishmentId"));
    const batch = await claimNextTrackingBatch(db, identity.userId, { excludeEstablishmentIds: exclude, ...(only.success ? { onlyEstablishmentId: only.data } : {}) });
    if (!batch) return NextResponse.json({ establishment: null });
    return NextResponse.json({
      establishment: {
        id: batch.establishment.id,
        cnpj: batch.establishment.cnpj,
        razaoSocial: batch.establishment.razao_social,
        situacaoCadastral: batch.establishment.situacao_cadastral,
      },
      accessContext: batch.accessContext,
      tasks: batch.tasks,
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível localizar as solicitações a acompanhar." }, { status: 500 });
  }
}
