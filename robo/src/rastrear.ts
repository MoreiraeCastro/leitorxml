import { type PortalApi, type TrackingBatch } from "./api.ts";
import { FiscoSession, type ProcuracaoLink } from "./fisco.ts";
import { classifySituacao, interpretRow, pickRowForTask, type TrackedTask } from "./solicitacoes.ts";

export type RastrearOptions = { session: FiscoSession; api: PortalApi; staleHours: number | null; maxEmpresas: number; deadlineAt: number; log: (message: string) => void };
export type RastrearResult = { empresasConferidas: number; empresasComFalha: number; baixadas: number; semDocumentos: number; aguardando: number; motivoDeParada: string };

const MAX_FALHAS_SEGUIDAS = 3;
const MAX_PAGINAS_SOLICITACOES = 10;
const PAUSA_ENTRE_EMPRESAS_MS = 20_000;

type Counters = { baixadas: number; semDocumentos: number; aguardando: number };
type Company = NonNullable<TrackingBatch["establishment"]>;
type Access = NonNullable<TrackingBatch["accessContext"]>;

/** Entra na procuração da empresa e na própria empresa. Com a posição conhecida vai direto; sem ela, testa as procurações do grupo até achar o CNPJ. */
async function enterCompany(session: FiscoSession, establishment: Company, accessContext: Access, log: (message: string) => void) {
  if (accessContext.type !== "PROCURACAO") throw new Error("CERTIFICADO_PROPRIO_NAO_SUPORTADO: esta empresa não entra por procuração do escritório — verificar manualmente");
  await session.goHome();
  const links = await session.listProcuracoes();
  if (!links.length) throw new Error("NENHUMA_PROCURACAO_ENCONTRADA_NO_MODAL");

  const known = accessContext.posicao != null ? links.find((l) => l.posicao === accessContext.posicao && (accessContext.grupo == null || l.grupo === accessContext.grupo)) : undefined;
  if (accessContext.posicao != null && !known) throw new Error(`PROCURACAO_NAO_ENCONTRADA: grupo=${accessContext.grupo} posicao=${accessContext.posicao} (o modal tem ${links.length})`);
  const queue: ProcuracaoLink[] = known ? [known] : links.filter((l) => accessContext.grupo == null || l.grupo === accessContext.grupo);

  for (const [position, link] of queue.entries()) {
    if (position > 0) {
      await session.goHome();
      await session.listProcuracoes();
    }
    log(`entrando na procuração grupo=${link.grupo} posicao=${link.posicao}${known ? "" : " (descoberta)"}`);
    await session.enterProcuracao(link);
    if (await session.openCompany(establishment.cnpj)) return;
    if (known) throw new Error(`EMPRESA_NAO_ENCONTRADA_NA_PROCURACAO: ${establishment.cnpj}`);
  }
  throw new Error(`CNPJ_NAO_ENCONTRADO_EM_NENHUMA_PROCURACAO_TESTADA: ${establishment.cnpj}`);
}

/** Baixa os arquivos da solicitação "Processada" (página de detalhe) e envia ao portal. */
async function downloadAndUpload(session: FiscoSession, api: PortalApi, task: TrackedTask, rowIndex: number, log: (message: string) => void) {
  await session.openDetail(rowIndex);
  const files = await session.downloadFiles();
  for (const file of files) {
    const result = await api.uploadZip(task.id, file.bytes);
    log(`${task.tipoDocumento}/${task.papel}: ${file.name} (${file.bytes.length} bytes) enviado — validação ${result.resultadoValidacao}, ${result.documentCount} documento(s)`);
  }
}

/** Visita uma empresa: lê a aba Solicitações, atualiza a situação de cada tarefa pendente e baixa o que estiver pronto. */
async function visitCompany(options: RastrearOptions, establishment: Company, accessContext: Access, tasks: TrackedTask[], counters: Counters) {
  const { session, api, log } = options;
  await enterCompany(session, establishment, accessContext, log);
  await session.openSolicitacoes();

  const pending = new Map(tasks.map((task) => [task.id, task]));
  let rowsSeen = 0;
  // Depois de cada download a página sai da aba (vai pro detalhe) e volta: recomeça pelas tarefas que sobraram.
  for (let round = 0; round <= tasks.length && pending.size; round++) {
    let leftTab = false;
    for (let page = 1; page <= MAX_PAGINAS_SOLICITACOES && pending.size && !leftTab; page++) {
      const rows = (await session.readSolicitacoes()).map(interpretRow);
      rowsSeen += rows.length;
      log(`aba Solicitações, página ${page}: ${rows.length} linha(s); 1ª = "${rows[0]?.referencia ?? "-"} / ${rows[0]?.situacaoTexto ?? "-"}"`);
      for (const task of [...pending.values()]) {
        const row = pickRowForTask(rows, task);
        if (!row) continue;
        pending.delete(task.id);
        const status = classifySituacao(row.situacaoTexto);
        log(`${task.tipoDocumento}/${task.papel}: "${row.situacaoTexto}" -> ${status}`);
        const referencia = row.referencia.slice(0, 120);
        try {
          if (status === "DESCONHECIDA") {
            await api.fail(task.id, `SITUACAO_DESCONHECIDA na aba Solicitações: "${row.situacaoTexto}" (referência: ${row.referencia})`);
          } else if (status !== "PRONTO_PARA_BAIXAR") {
            await api.report(task.id, status, referencia);
            if (status === "SEM_DOCUMENTOS") counters.semDocumentos += 1;
            if (status === "PROCESSANDO_SEFAZ") counters.aguardando += 1;
          } else if (!row.temLink) {
            await api.fail(task.id, "LINK_DA_SOLICITACAO_NAO_ENCONTRADO na linha da aba Solicitações");
          } else {
            await api.report(task.id, "PRONTO_PARA_BAIXAR", referencia);
            leftTab = true; // a partir daqui a página navega pro detalhe, dê certo ou não
            await downloadAndUpload(session, api, task, row.index, log);
            counters.baixadas += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log(`FALHA ${task.tipoDocumento}/${task.papel}: ${message.slice(0, 200)}`);
          // Falha ao BAIXAR não condena a tarefa: o arquivo continua pronto no Fisco Fácil (7 dias) e a próxima rodada tenta de novo.
          // Só falhas ANTES do download (situação ilegível etc.) viram falha da tarefa.
          if (!leftTab) await api.fail(task.id, `ERRO_NO_ROBO: ${message}`).catch(() => {});
        }
        if (leftTab) break;
      }
      if (leftTab || !pending.size) break;
      if (!(await session.nextSolicitacoesPage())) break;
    }
    if (!leftTab) break;
    await session.backToCompany();
    await session.openSolicitacoes();
  }

  for (const task of pending.values()) {
    await api.fail(task.id, `SOLICITACAO_NAO_ENCONTRADA_NO_HISTORICO (${task.tipoDocumento}/${task.papel} ${String(task.competenciaMes).padStart(2, "0")}/${task.competenciaAno}; ${rowsSeen} linha(s) lidas)`);
  }
}

/** Percorre as empresas com solicitações pendentes, uma por vez, até acabar, estourar o tempo ou falhar 3 vezes seguidas. */
export async function rastrear(options: RastrearOptions): Promise<RastrearResult> {
  const { api, log } = options;
  const visited: string[] = [];
  const counters: Counters = { baixadas: 0, semDocumentos: 0, aguardando: 0 };
  let falhasSeguidas = 0;
  let empresasComFalha = 0;
  let motivoDeParada = "Fila concluída.";

  while (true) {
    if (visited.length >= options.maxEmpresas) {
      motivoDeParada = `Parou no limite de ${options.maxEmpresas} empresas.`;
      break;
    }
    if (Date.now() > options.deadlineAt) {
      motivoDeParada = "Parou por tempo máximo da rodada.";
      break;
    }
    const batch = await api.nextTrackingCompany(visited, options.staleHours);
    if (!batch.establishment || !batch.accessContext || !batch.tasks) break;
    const company = batch.establishment;
    visited.push(company.id);
    // Ritmo calmo entre empresas: o Fisco Fácil bloqueia quem parece estar martelando o portal.
    if (visited.length > 1) await new Promise((resolve) => setTimeout(resolve, PAUSA_ENTRE_EMPRESAS_MS));
    log(`=== ${company.razaoSocial} (${company.cnpj}) — ${batch.tasks.length} solicitação(ões) a conferir ===`);
    try {
      await visitCompany(options, company, batch.accessContext, batch.tasks, counters);
      falhasSeguidas = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      falhasSeguidas += 1;
      empresasComFalha += 1;
      log(`FALHA na empresa ${company.razaoSocial}: ${message.slice(0, 300)}`);
      // Falha da EMPRESA (não achou a procuração, travou...) não marca as tarefas como falhas: é transitória
      // e a próxima rodada tenta de novo. Fica só no log do robô.
      if (/BLOQUEADO_PELA_SEFAZ/.test(message)) {
        motivoDeParada = `Parou: ${message}`;
        break;
      }
      if (falhasSeguidas >= MAX_FALHAS_SEGUIDAS) {
        motivoDeParada = `Parou após ${falhasSeguidas} empresas seguidas com falha. Última: ${message.slice(0, 200)}`;
        break;
      }
    }
  }
  return { empresasConferidas: visited.length - empresasComFalha, empresasComFalha, ...counters, motivoDeParada };
}
