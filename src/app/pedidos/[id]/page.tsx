import { notFound } from "next/navigation";
import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmptyState, PageHeader, Shell } from "@/components/shell";
import { STATUS_LABELS, canRequestAgain, competenciaLabel, documentLabel, roleLabel, statusTone } from "@/lib/leitorxml/status-labels";
import type { XmlCollectionStatus } from "@/lib/leitorxml/types";
import { marcarRevisado, pedirDeNovo } from "../actions";
import { enviarTarefaSharePoint } from "@/app/sharepoint/actions";

export const metadata = { title: "Detalhe do pedido" };

const TONE_CLASS: Record<string, string> = {
  ok: "pill-ok",
  warn: "pill-warn",
  info: "pill-info",
  danger: "pill-danger",
  neutral: "",
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
      <PageHeader
        back={{ href: "/painel", label: "Início" }}
        title={establishment?.razao_social}
        subtitle={<span className="tabular">{establishment?.cnpj} · {documentLabel(task.tipo_documento)} · {roleLabel(task.papel)} · {competenciaLabel(task.competencia_ano, task.competencia_mes)}</span>}
        actions={<span className={`pill h-[26px] px-3 text-[12px] ${TONE_CLASS[statusTone(status)]}`}><span className="dot" aria-hidden="true" />{STATUS_LABELS[status]}</span>}
      />

      <div className="flex flex-col gap-3">
        {task.erro_mensagem && <p className="callout callout-danger">{task.erro_mensagem}</p>}

        {canRequestAgain(task.status) && (
          <form action={pedirDeNovoAction} className="callout callout-warn flex flex-wrap items-center gap-3">
            <p className="min-w-[16rem] flex-1">Este pedido {task.status === "EXPIRADA" ? "venceu no Fisco Fácil (passou dos 7 dias)" : "não deu certo"}. Você pode devolvê-lo à fila: na próxima vez que a extensão pedir, ele será o primeiro.</p>
            <button type="submit" className="btn">Pedir de novo</button>
          </form>
        )}

        {task.baixado_at && (
          <p className="callout callout-ok tabular">
            ✓ Baixado em {fmt(task.baixado_at)}{task.baixado_por_nome ? ` por ${task.baixado_por_nome}` : ""}.
          </p>
        )}
        {task.status === "DISPONIVEL_REVISAO" && (
          <div className="callout flex flex-wrap items-center gap-3">
            <p className="min-w-[16rem] flex-1 text-[var(--text-2)]">O ZIP está no portal e ainda não foi salvo em nenhum PC. A extensão salva sozinha com o Chrome aberto.</p>
            <form action={revisarAction}>
              <button type="submit" className="btn btn-secondary">Marcar como revisado</button>
            </form>
          </div>
        )}
      </div>

      <section className="mt-7">
        <h2 className="section-title">Linha do tempo</h2>
        <dl className="card mt-3 grid grid-cols-[minmax(0,14rem)_1fr] gap-x-8 gap-y-2.5 px-5 py-4 text-[13px]">
          <dt className="text-[var(--text-2)]">Criado em</dt><dd className="tabular">{fmt(task.created_at)}</dd>
          <dt className="text-[var(--text-2)]">Última atualização</dt><dd className="tabular">{fmt(task.updated_at)}</dd>
          <dt className="text-[var(--text-2)]">Última verificação</dt><dd className="tabular">{fmt(task.ultima_verificacao_at)}</dd>
          <dt className="text-[var(--text-2)]">Tentativas</dt><dd className="tabular">{task.tentativas}</dd>
          <dt className="text-[var(--text-2)]">Referência no Fisco Fácil</dt><dd className="tabular">{task.sefaz_referencia ?? "—"}</dd>
          <dt className="text-[var(--text-2)]">Previsão de conclusão (SEFAZ)</dt><dd className="tabular">{fmt(task.sefaz_previsao_conclusao)} <span className="text-[12px] text-[var(--muted)]">(não confiável — ver handoff)</span></dd>
        </dl>
      </section>

      <section className="mt-7">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title">Arquivos</h2>
          {task.storage_path_zip && <a href={`/pedidos/${id}/baixar`} className="btn btn-secondary btn-sm">Baixar ZIP</a>}
        </div>
        {!files?.length && (
          <div className="card mt-3">
            <EmptyState title="Nenhum arquivo recebido ainda" text="O ZIP aparece aqui assim que a extensão baixar e validar o pedido." />
          </div>
        )}
        {!!files?.length && (
          <div className="table-wrap mt-3">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Recebido em</th>
                  <th className="text-right">Documentos</th>
                  <th className="text-right">Tamanho</th>
                  <th>Validação</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td className="tabular">{fmt(file.created_at)}</td>
                    <td className="num">{file.quantidade_documentos ?? "—"}</td>
                    <td className="num">{(file.tamanho_bytes / 1024).toFixed(1)} KB</td>
                    <td>
                      <span className={`pill ${file.resultado_validacao === "OK" ? TONE_CLASS.ok : file.resultado_validacao === "QUARENTENA" ? TONE_CLASS.warn : TONE_CLASS.danger}`}>{file.resultado_validacao}</span>
                    </td>
                    <td className="font-mono text-[12px] text-[var(--text-2)]">{file.hash_sha256.slice(0, 12)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-7">
        <h2 className="section-title">SharePoint</h2>
        <div className="card mt-3 px-5 py-4">
          <p className="text-[13px] text-[var(--ink)]">
            {task.sharepoint_path
              ? task.sharepoint_path.startsWith("local:")
                ? `Entregue na pasta do SharePoint (pelo computador): ${task.sharepoint_path.replace(/^local:\s*/, "")}`
                : task.sharepoint_path
              : "Ainda não entregue na pasta do SharePoint. A extensão salva o arquivo assim que um computador configurado estiver com o Chrome aberto."}
          </p>
          {establishment?.sharepoint_folder_path && <p className="help mt-1">Pasta cadastrada para esta empresa: {establishment.sharepoint_folder_path}</p>}
          {task.storage_path_zip && !task.sharepoint_item_id && (
            <form action={enviarAction} className="mt-3"><button type="submit" className="btn btn-secondary btn-sm">Enviar ao SharePoint agora</button></form>
          )}
        </div>
      </section>
    </Shell>
  );
}
