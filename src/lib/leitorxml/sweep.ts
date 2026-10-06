import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPendingToSharePoint } from "./sharepoint";
import { escalateStaleProcessing, generateMonthlyTasks, previousClosedCompetencia } from "./tasks";

/** Mesmo padrão de src/lib/nfse/reconciliation/sweep.ts: comparação em tempo constante, qualquer diferença de tamanho já é rejeição sem comparar. */
export function isAuthorizedInternalRequest(providedSecret: string | null, expectedSecret: string | undefined): boolean {
  if (!expectedSecret || !providedSecret) return false;
  const expectedBuffer = Buffer.from(expectedSecret);
  const providedBuffer = Buffer.from(providedSecret);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export type LeitorXmlSweepResult = { escalated: number; sharepoint?: { attempted: number; sent: number; failed: number; skipped: boolean } | { error: string }; monthlyBatch: { ranToday: boolean; establishments: number; tasksCreated: number } };

/**
 * Roda a cada poucos dias via cron externo. A partir do dia 10 (inclusive),
 * gera o lote mensal do mês anterior fechado — idempotente pela UNIQUE da
 * tabela, então rodar de novo em dias seguintes não duplica nada, só cobre o
 * caso do disparo não cair exatamente no dia 10. Em qualquer dia, escalona
 * solicitações que passaram do prazo de espera da SEFAZ (SEFAZ_MAX_WAIT_DAYS, contado desde o pedido) para revisão manual
 * (§4 da Descoberta: a previsão de conclusão da SEFAZ não é confiável).
 */
export async function runLeitorXmlSweep(input: { db: SupabaseClient; now?: Date }): Promise<LeitorXmlSweepResult> {
  const now = input.now ?? new Date();
  const escalation = await escalateStaleProcessing(input.db, { now });
  const ranToday = now.getUTCDate() >= 10;
  const monthlyBatch = ranToday ? await generateMonthlyTasks(input.db, previousClosedCompetencia(now)) : { establishments: 0, tasksCreated: 0 };
  // Reenvia pro SharePoint o que ficou em staging (login expirado, pasta ainda não escolhida...). Falha aqui não derruba a varredura.
  const sharepoint = await sendPendingToSharePoint(input.db).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
  return { escalated: escalation.escalated, sharepoint, monthlyBatch: { ranToday, ...monthlyBatch } };
}
