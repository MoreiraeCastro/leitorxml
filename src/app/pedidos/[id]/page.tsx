import { notFound } from "next/navigation";
import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell } from "@/components/shell";
import { STATUS_LABELS, canRequestAgain, competenciaLabel, documentLabel, roleLabel, statusTone } from "@/lib/leitorxml/status-labels";
import type { XmlCollectionStatus } from "@/lib/leitorxml/types";
import { marcarRevisado, pedirDeNovo } from "../actions";
import { enviarTarefaSharePoint } from "@/app/sharepoint/actions";

export const metadata = { title: "Detalhe do pedido" };

const TONE_CLASS: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  info: "bg-sky-50 text-sky-700",
  danger: "bg-red-50 text-red-700",
  neutral: "bg-black/5 text-black/60",
};

function fmt(value: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

export default async function PedidoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOfficeSessionOrRedirect();
  const { id } = await params;
  const db = createAdminClient();
  const { data: task } = await db
    .from("xml_collection_tasks")
    .select("*,xml_watch_establishments(id,cnpj,razao_social,sharepoint_folder_path)")
    .eq("id", id)
    .maybeSingle();
  if (!task) notFound();
  const status = task.status as XmlCollectionStatus;
  const establishment = Array.isArray(task.xml_watch_establishments) ? task.xml_watch_establishments[0] : task.xml_watch_establishments;
  const { data: files } = await db.from("xml_collection_files").select("*").eq("task_id", id).order("created_at", { ascending: false });

  const revisarAction = marcarRevisado.bind(null, id);
  const pedirDeNovoAction = pedirDeNovo.bind(null, id);
  const enviarAction = enviarTarefaSharePoint.bind(null, id);

  return (
    <Shell session={session}>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[#082240]">{establishment?.razao_social}</h1>
          <p className="text-sm text-black/60">{establishment?.cnpj} · {documentLabel(task.tipo_documento)} · {roleLabel(task.papel)} · {competenciaLabel(task.competencia_ano, task.competencia_mes)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${TONE_CLASS[statusTone(status)]}`}>{STATUS_LABELS[status]}</span>
      </div>

      {task.erro_mensagem && <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{task.erro_mensagem}</p>}

      {canRequestAgain(task.status) && (
        <form action={pedirDeNovoAction} className="mt-4 rounded border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">Este pedido {task.status === "EXPIRADA" ? "venceu no Fisco Fácil (passou dos 7 dias)" : "não deu certo"}. Você pode devolvê-lo à fila: na próxima vez que a extensão pedir, ele será o primeiro.</p>
          <button type="submit" className="mt-3 rounded bg-[#082240] px-4 py-2 text-sm font-medium text-white hover:bg-[#123a5d]">Pedir de novo</button>
        </form>
      )}

      {task.status === "DISPONIVEL_REVISAO" && (
        <form action={revisarAction} className="mt-4">
          <button type="submit" className="rounded bg-[#082240] px-4 py-2 text-sm font-medium text-white hover:bg-[#123a5d]">Marcar como revisado</button>
        </form>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black/50">Linha do tempo</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <dt className="text-black/50">Criado em</dt><dd>{fmt(task.created_at)}</dd>
          <dt className="text-black/50">Última atualização</dt><dd>{fmt(task.updated_at)}</dd>
          <dt className="text-black/50">Última verificação</dt><dd>{fmt(task.ultima_verificacao_at)}</dd>
          <dt className="text-black/50">Tentativas</dt><dd>{task.tentativas}</dd>
          <dt className="text-black/50">Referência no Fisco Fácil</dt><dd>{task.sefaz_referencia ?? "—"}</dd>
          <dt className="text-black/50">Previsão de conclusão (SEFAZ)</dt><dd>{fmt(task.sefaz_previsao_conclusao)} <span className="text-xs text-black/40">(não confiável — ver handoff)</span></dd>
        </dl>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-black/50">Arquivos</h2>
          {task.storage_path_zip && <a href={`/pedidos/${id}/baixar`} className="rounded border border-black/15 px-3 py-1 text-sm font-medium text-[#082240] hover:bg-black/[0.03]">Baixar ZIP</a>}
        </div>
        {!files?.length && <p className="mt-3 text-sm text-black/50">Nenhum arquivo recebido ainda.</p>}
        {!!files?.length && (
          <div className="mt-3 overflow-x-auto rounded border border-black/10 bg-white">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
                  <th className="px-4 py-2">Recebido em</th>
                  <th className="px-4 py-2">Documentos</th>
                  <th className="px-4 py-2">Tamanho</th>
                  <th className="px-4 py-2">Validação</th>
                  <th className="px-4 py-2">Hash</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id} className="border-b border-black/5 last:border-0">
                    <td className="px-4 py-2">{fmt(file.created_at)}</td>
                    <td className="px-4 py-2">{file.quantidade_documentos ?? "—"}</td>
                    <td className="px-4 py-2">{(file.tamanho_bytes / 1024).toFixed(1)} KB</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${file.resultado_validacao === "OK" ? TONE_CLASS.ok : file.resultado_validacao === "QUARENTENA" ? TONE_CLASS.warn : TONE_CLASS.danger}`}>{file.resultado_validacao}</span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-black/50">{file.hash_sha256.slice(0, 12)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black/50">SharePoint</h2>
        <p className="mt-3 text-sm text-black/60">
          {task.sharepoint_path
            ? task.sharepoint_path.startsWith("local:")
              ? `Entregue na pasta do SharePoint (pelo computador): ${task.sharepoint_path.replace(/^local:\s*/, "")}`
              : task.sharepoint_path
            : "Ainda não entregue na pasta do SharePoint. A extensão salva o arquivo assim que um computador configurado estiver com o Chrome aberto."}
        </p>
        {task.storage_path_zip && !task.sharepoint_item_id && (
          <form action={enviarAction} className="mt-3"><button type="submit" className="rounded border border-black/15 px-3 py-1 text-sm font-medium text-[#082240] hover:bg-black/[0.03]">Enviar ao SharePoint agora</button></form>
        )}
        {establishment?.sharepoint_folder_path && <p className="mt-1 text-xs text-black/40">Pasta cadastrada para esta empresa: {establishment.sharepoint_folder_path}</p>}
      </section>
    </Shell>
  );
}
