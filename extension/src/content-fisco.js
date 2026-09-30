// Roda em fisco-facil.fazenda.rj.gov.br — as 3 páginas do fluxo real:
// principalContribuintes.xhtml (lista de empresas da procuração),
// mainAbasContribuinte.xhtml (painel da empresa) e
// solicitacoes/solicitacaoExtracaoDfe.xhtml (formulário de extração).
// Mapeado ao vivo (gravação de tela) em 2026-09-29 — ver _handoff/.

const DOC_VALUE = { NFE: "1", NFCE: "2" };
const PARTICIPANTE_LABEL = { EMITENTE: "Emitente", DESTINATARIO: "Destinatário" };

async function getActiveRun() {
  const response = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_RUN" });
  return response?.run ?? null;
}
async function setRunFlag(patch) {
  const run = await getActiveRun();
  if (!run) return null;
  const next = { ...run, ...patch };
  await chrome.storage.session.set({ activeRun: next });
  return next;
}
async function reportStatus(status, extra = {}) {
  await chrome.runtime.sendMessage({ type: "REPORT_STATUS", status, ...extra });
}
async function reportFailure(motivo) {
  await chrome.runtime.sendMessage({ type: "REPORT_FAILURE", motivo });
}

function formatCnpjMask(cnpj) {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/** Formata como visto na tela após escolher "Meses" (ex.: "08/2026"). Ponto a validar na PoC — pode ser que o servidor espere outro formato. */
function formatCompetencia(ano, mes) {
  return `${String(mes).padStart(2, "0")}/${ano}`;
}

// ---------- Página: principalContribuintes.xhtml (lista de empresas) ----------

/** Lê CNPJ/IE/Razão/Situação de todas as linhas visíveis na página atual da tabela (sem busca — é a lista completa da procuração). */
function readContribuinteRows() {
  const body = document.getElementById("FrmFisco:ListaContribuintes_data");
  const rows = [...(body?.querySelectorAll("tr") ?? [])];
  return rows
    .map((tr) => {
      const cells = tr.querySelectorAll("td");
      return {
        cnpj: cells[1]?.textContent.trim().replace(/\D/g, "") ?? "",
        inscricaoEstadual: cells[2]?.textContent.trim() || null,
        razaoSocial: cells[3]?.textContent.trim() ?? "",
        situacaoCadastral: cells[6]?.textContent.trim() ?? "",
      };
    })
    .filter((row) => row.cnpj.length === 14);
}

/**
 * Varredura completa de uma procuração: lê a página atual inteira (cadastra
 * cada linha não-Baixada via REGISTER_ESTABLISHMENT), pagina pra frente
 * enquanto houver "Próxima página", e ao esgotar avisa o background pra
 * seguir pra próxima procuração da fila.
 */
async function sweepCurrentPage(run) {
  const current = run.sweepQueue[run.sweepCursor];
  for (const row of readContribuinteRows()) {
    if (row.situacaoCadastral === "Baixada") continue;
    await chrome.runtime.sendMessage({ type: "REGISTER_ESTABLISHMENT", ...row, procuracaoGrupo: current.grupo, posicao: current.posicao });
  }

  const nextPageLink = document.querySelector(".ui-paginator-next");
  if (nextPageLink && !nextPageLink.classList.contains("ui-state-disabled")) {
    realClick(nextPageLink);
    await waitForAjaxIdle({ label: "AJAX da próxima página da lista de empresas" });
    // A tabela é recriada via AJAX a cada página — mesma cautela do clique de linha (ver realClick em dom-utils.js).
    await new Promise((resolve) => setTimeout(resolve, 400));
    await sweepCurrentPage(run);
    return;
  }

  // Esgotou todas as páginas dessa procuração.
  await chrome.runtime.sendMessage({ type: "SWEEP_NEXT_POSITION" });
}

async function handleListaContribuintes(run) {
  const searchInput = document.getElementById("FrmFisco:valorDaPesquisa_input") ?? document.getElementById("FrmFisco:valorDaPesquisa");
  if (!searchInput) throw new Error("CAMPO_BUSCA_CNPJ_NAO_ENCONTRADO");
  setInputValue(searchInput, formatCnpjMask(run.establishment.cnpj));

  const filtrarButton = findByExactText("button", "Filtrar") ?? [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Filtrar"));
  if (!filtrarButton) throw new Error("BOTAO_FILTRAR_NAO_ENCONTRADO");
  realClick(filtrarButton);
  await waitForAjaxIdle({ label: "AJAX da busca por CNPJ terminar" });

  const body = document.getElementById("FrmFisco:ListaContribuintes_data");
  const emptyRow = body?.querySelector(".ui-datatable-empty-message");
  if (emptyRow) {
    if (run.discovery) {
      // Não é essa procuração — pede pro background tentar a próxima da fila (history.back() + reclique).
      await chrome.runtime.sendMessage({ type: "DISCOVERY_NOT_FOUND" });
      return;
    }
    throw new Error(`EMPRESA_NAO_ENCONTRADA_NA_PROCURACAO: ${run.establishment.cnpj}`);
  }

  const row = body?.querySelector("tr");
  if (!row) throw new Error("LINHA_DA_EMPRESA_NAO_ENCONTRADA");
  if (run.discovery) {
    // Achou — reporta pro backend cachear (grupo, posição, CNPJ) no índice antes de prosseguir.
    const current = run.discovery.queue[run.discovery.cursor];
    await chrome.runtime.sendMessage({ type: "DISCOVERY_FOUND", grupo: current.grupo, posicao: current.posicao });
  }
  // A tabela é recriada via AJAX após a busca — o PrimeFaces religa os
  // listeners de seleção de linha na tabela nova um instante depois do
  // #loading sumir, não no mesmo tick.
  await new Promise((resolve) => setTimeout(resolve, 500));
  // Clique real (chrome.debugger), não sintético — entrar na empresa depende de
  // navegação de página de verdade, que exige "ativação de usuário" (confirmado
  // ao vivo, 2026-09-30: mesmo bug do clique pra entrar em procuração).
  await realNavigationClick(row);
  await waitFor(() => location.pathname.includes("mainAbasContribuinte"), { timeoutMs: 15000, label: "navegação pra mainAbasContribuinte após clicar na empresa" });
}

/**
 * Nome do titular do certificado, sempre visível na barra superior do Fisco
 * Fácil. Lê do atributo `title` (ex.: "PAULO ROBERTO SILVA CASTRO (CPF:
 * 10822759721) - Acesso por procuração"), não do `textContent` — o span
 * `.id-usu-txt` real tem um `<form>` de menu inteiro aninhado dentro dele,
 * então `textContent` viria com esse lixo junto (confirmado via HTML real).
 */
function readCertificateHolderName() {
  const span = document.querySelector(".id-usu-txt");
  const title = span?.getAttribute("title");
  if (!title) return null;
  return title.split(/\s*\(CPF:|\s+-\s+Acesso/i)[0].trim();
}

/** Empresa atualmente selecionada, se estivermos numa página com contexto de estabelecimento (mainAbasContribuinte, solicitacaoExtracaoDfe). */
function readSelectedCompany() {
  const nameEl = document.getElementById("frmDadosContrib:noRazao");
  return { empresa: nameEl?.textContent.trim() ?? null, cnpj: readHeaderCnpj() };
}

// ---------- Página: mainAbasContribuinte.xhtml (painel da empresa) ----------
function readHeaderCnpj() {
  const text = document.body.textContent;
  const match = text.match(/Num\.\s*CNPJ:\s*([\d./-]+)/);
  return match?.[1]?.replace(/\D/g, "") ?? null;
}

async function openExtractionForm() {
  const link = document.getElementById("frmMenuLateral:fieldExtracaoID") ?? findByExactText("a", "Extração de documentos fiscais");
  if (!link) throw new Error("LINK_EXTRACAO_NAO_ENCONTRADO");
  await realNavigationClick(link);
  await waitFor(() => location.pathname.includes("solicitacaoExtracaoDfe") || document.getElementById("FrmSolicitarExtracaoDfe"), {
    timeoutMs: 15000,
    label: "abrir formulário de extração",
  });
}

async function openSolicitacoesTab() {
  const tabLink = findByExactText("a", "Solicitações");
  if (!tabLink) throw new Error("ABA_SOLICITACOES_NAO_ENCONTRADA");
  realClick(tabLink);
  await waitForAjaxIdle({ label: "AJAX da aba Solicitações terminar" });
  await waitFor(() => document.getElementById("frmHistInteracoes:tabsHist:solicitacao_data"), { timeoutMs: 10000, label: "tabela de solicitações carregar" });
}

function classifySituacao(text) {
  const normalized = text.trim().toLowerCase();
  if (normalized.includes("aguardando")) return "PROCESSANDO_SEFAZ";
  if (normalized.includes("expirad")) return "EXPIRADA";
  if (normalized.includes("sem resultado")) return "SEM_DOCUMENTOS";
  if (normalized.includes("erro")) return "FALHA";
  return "PRONTO_PARA_BAIXAR"; // "Processada"/"Processada com resultado" ou variação não mapeada — assume pronto.
}

async function readLatestSolicitacaoAndAct(run) {
  const body = document.getElementById("frmHistInteracoes:tabsHist:solicitacao_data");
  const row = body?.querySelector('tr[data-ri="0"]') ?? body?.querySelector("tr");
  if (!row) throw new Error("NENHUMA_SOLICITACAO_ENCONTRADA");
  const cells = row.querySelectorAll("td");
  const referencia = cells[2]?.textContent.trim() ?? "";
  const expectedDocLabel = run.tipoDocumento === "NFCE" ? "NFC-e" : "NF-e";
  const expectedParticipanteLabel = PARTICIPANTE_LABEL[run.papel];
  if (!referencia.includes(expectedDocLabel) || !referencia.includes(expectedParticipanteLabel)) {
    throw new Error(`REFERENCIA_NAO_BATE_COM_A_TAREFA: esperado "${expectedDocLabel} - ${expectedParticipanteLabel}", encontrado "${referencia}"`);
  }
  const situacaoLink = cells[3]?.querySelector("a");
  const situacaoTexto = situacaoLink?.textContent.trim() ?? cells[3]?.textContent.trim() ?? "";
  const status = classifySituacao(situacaoTexto);

  if (status === "PRONTO_PARA_BAIXAR") {
    await chrome.runtime.sendMessage({ type: "EXPECT_DOWNLOAD" });
    if (situacaoLink) realClick(situacaoLink);
    // dá um tempo pro download disparar e o background capturar; se em vez disso
    // abrir um modal (nosso mapeamento de texto errou), lê o modal e reclassifica.
    const dialog = await waitFor(() => {
      const el = [...document.querySelectorAll(".ui-dialog")].find((d) => d.offsetParent && d.textContent.includes("Solicitação de Extração"));
      return el ?? null;
    }, { timeoutMs: 4000, label: "modal de resultado da solicitação aparecer" }).catch(() => null);
    if (dialog) {
      const realStatus = classifySituacao(dialog.textContent);
      const fechar = findByExactText("button", "Fechar", dialog) ?? dialog.querySelector("button");
      if (fechar) realClick(fechar);
      await reportStatus(realStatus === "PRONTO_PARA_BAIXAR" ? "AGUARDANDO_INTERVENCAO" : realStatus, { sefazReferencia: referencia });
      return;
    }
    // sem modal: assume que o download disparou; o background cuida do upload e finaliza a tarefa sozinho.
    await new Promise((resolve) => setTimeout(resolve, 4000));
    return;
  }

  await reportStatus(status, { sefazReferencia: referencia });
}

// ---------- Página: solicitacaoExtracaoDfe.xhtml (formulário) ----------
async function selectParticipante(label) {
  const target = findByExactText("label", label);
  if (!target) throw new Error(`OPCAO_PARTICIPANTE_NAO_ENCONTRADA: ${label}`);
  const radio = target.closest("td")?.querySelector('input[type="radio"]') ?? document.getElementById(target.getAttribute("for"));
  realClick(radio ?? target);
}

async function fillAndSubmitExtractionForm(run) {
  const mesesRadio = document.getElementById("FrmSolicitarExtracaoDfe:tpPesquisaDM:1");
  if (!mesesRadio.checked) {
    realClick(mesesRadio);
    await waitFor(() => document.getElementById("FrmSolicitarExtracaoDfe:dtInicioDia_input"), { timeoutMs: 5000, label: "campos de data aparecerem após marcar Meses" });
  }
  // Fecha o calendário popup que abre ao marcar "Meses", e seta o valor direto —
  // não navega o datepicker por clique. Formato a confirmar na PoC (ver formatCompetencia).
  document.body.click();
  const competencia = formatCompetencia(run.competenciaAno, run.competenciaMes);
  setInputValue(document.getElementById("FrmSolicitarExtracaoDfe:dtInicioDia_input"), competencia);
  setInputValue(document.getElementById("FrmSolicitarExtracaoDfe:dtFimDia_input"), competencia);

  const docRadio = document.querySelector(`input[name="FrmSolicitarExtracaoDfe:tpDocumento"][value="${DOC_VALUE[run.tipoDocumento]}"]`);
  if (!docRadio) throw new Error(`OPCAO_DOCUMENTO_NAO_ENCONTRADA: ${run.tipoDocumento}`);
  realClick(docRadio);
  await waitForAjaxIdle({ label: "AJAX popular PARTICIPA DO DOCUMENTO COMO" });

  await selectParticipante(PARTICIPANTE_LABEL[run.papel]);

  const confirmar = document.getElementById("FrmSolicitarExtracaoDfe:submitPesquisa");
  if (!confirmar) throw new Error("BOTAO_CONFIRMAR_EXTRACAO_NAO_ENCONTRADO");
  await realNavigationClick(confirmar);
  await waitFor(() => location.pathname.includes("mainAbasContribuinte"), { timeoutMs: 15000, label: "navegação de volta após confirmar solicitação de extração" });
}

// ---------- Orquestração ----------
(async () => {
  const certificado = readCertificateHolderName();
  const { empresa, cnpj } = readSelectedCompany();
  if (certificado || empresa || cnpj) await setConnectionStatus({ certificado, empresa, cnpj });

  const run = await getActiveRun();
  if (!run) return;

  if (run.mode === "SWEEP") {
    // Varredura completa: só age na lista de empresas — não passa pelo formulário/acompanhamento (isso é trabalho da Fase 2, "Buscar próxima tarefa").
    if (location.pathname.includes("principalContribuintes")) {
      try {
        await sweepCurrentPage(run);
      } catch (error) {
        await chrome.runtime.sendMessage({ type: "REPORT_SWEEP_FAILURE", motivo: error.message });
      }
    }
    return;
  }

  if (run.accessContext?.type === "PROCURACAO" && !location.href.includes("fisco-facil")) return;

  try {
    if (location.pathname.includes("principalContribuintes")) {
      // Trava de segurança: se algo impedir a navegação pra mainAbasContribuinte
      // (ex.: o clique na linha não dispara o rowSelect do PrimeFaces do jeito
      // esperado), o content script reinjeta aqui de novo a cada reload e tentaria
      // pra sempre sem isso — melhor falhar alto do que ficar em loop.
      const attempts = (run.listaContribuintesAttempts ?? 0) + 1;
      if (attempts > 5) {
        await reportFailure(`Não consegui avançar da lista de empresas após ${attempts} tentativas — parando por segurança. Verificar manualmente.`);
        return;
      }
      await setRunFlag({ listaContribuintesAttempts: attempts });
      await handleListaContribuintes(run);
      return; // navegação leva pra mainAbasContribuinte; script reinjeta lá.
    }

    if (location.pathname.includes("solicitacaoExtracaoDfe")) {
      await fillAndSubmitExtractionForm(run);
      await setRunFlag({ formSubmitted: true });
      await reportStatus("SOLICITADO");
      return; // navegação de volta pra mainAbasContribuinte.
    }

    if (location.pathname.includes("mainAbasContribuinte")) {
      const cnpjNaTela = readHeaderCnpj();
      if (cnpjNaTela && cnpjNaTela !== run.establishment.cnpj) {
        await reportFailure(`CNPJ na tela (${cnpjNaTela}) não bate com o esperado (${run.establishment.cnpj}) — parando por segurança.`);
        return;
      }
      if (!run.formSubmitted) {
        await openExtractionForm();
        return; // navegação pro formulário.
      }
      await openSolicitacoesTab();
      await readLatestSolicitacaoAndAct(run);
      return;
    }
  } catch (error) {
    await reportFailure(error.message);
  }
})();

// Permite o background "cutucar" o content script já carregado (ex.: quando a
// próxima tarefa é da mesma empresa e não houve navegação de página).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "RUN_STEP") {
    location.reload();
    sendResponse({ ok: true });
  }
});
