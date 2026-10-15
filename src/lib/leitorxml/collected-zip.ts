import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateCollectedZip } from "@/lib/leitorxml/upload-validation";
import { sendTaskToSharePoint, sharePointReady } from "@/lib/leitorxml/sharepoint";

/**
 * Registra um ZIP já gravado no Storage (inteiro ou em partes — `storagePath` de zip-storage.ts): valida
 * (descompactação segura, hash, chaves de acesso), anota em xml_collection_files e põe a tarefa em revisão.
 * Usado pelo upload direto e pelo fechamento do upload em partes.
 */
export async function registerCollectedZip(db: SupabaseClient, task: { id: string; establishment_id: string }, buffer: Buffer, storagePath: string) {
  const validation = validateCollectedZip(buffer);
  const resultadoValidacao = validation.ok ? (validation.accessKeysFound.length ? "OK" : "QUARENTENA") : "REJEITADO";

  const { error: fileInsertError } = await db.from("xml_collection_files").insert({
    task_id: task.id,
    hash_sha256: validation.hashSha256,
    tamanho_bytes: validation.totalBytes,
    quantidade_documentos: validation.accessKeysFound.length,
    resultado_validacao: resultadoValidacao,
    detalhes_validacao: { entryCount: validation.entryCount, reason: validation.reason ?? null },
  });
  if (fileInsertError) throw fileInsertError;

  const nextStatus = resultadoValidacao === "REJEITADO" ? "AGUARDANDO_INTERVENCAO" : "DISPONIVEL_REVISAO";
  await db.from("xml_collection_tasks").update({ status: nextStatus, storage_path_zip: storagePath, updated_at: new Date().toISOString() }).eq("id", task.id);
  if (nextStatus === "DISPONIVEL_REVISAO") await db.from("xml_watch_establishments").update({ locked_by_user_id: null, locked_at: null }).eq("id", task.establishment_id);

  // Já em staging e registrado: o envio ao SharePoint é um passo à parte e não pode desfazer o upload. Se falhar, a tarefa segue em revisão com o erro anotado e a varredura tenta de novo.
  let sharepoint: "ENVIADO" | "PENDENTE" | "ERRO" | "NAO_CONFIGURADO" = "NAO_CONFIGURADO";
  if (nextStatus === "DISPONIVEL_REVISAO" && (await sharePointReady(db).catch(() => false))) {
    sharepoint = (await sendTaskToSharePoint(db, task.id)).ok ? "ENVIADO" : "ERRO";
  }
  return { ok: true as const, resultadoValidacao, documentCount: validation.accessKeysFound.length, sharepoint, reason: validation.reason ?? null };
}
