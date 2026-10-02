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
  await chrome.runtime.sendMessage({ type: "REPORT_FAILURE", motivo: motivo + describeDiagnostics() });
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
    await realNavigationClick(nextPageLink);
    await waitForAjaxIdle({ label: "AJAX da próxima página da lista de empresas" });
    // A tabela é recriada via AJAX a cada página — mesma cautela do clique de linha (ver realClick em dom-utils.js).
    await new Promise((resolve) => setTimeout(resolve, 400));
    await sweepCurrentPage(run);
    return;
  }

  // Esgotou todas as páginas dessa procuração.
  await chrome.runtime.sendMessage({ type: "SWEEP_NEXT_POSITION" });
}

/** Busca por CNPJ e devolve a 1ª linha do resultado, ou null se vier vazio ("nenhum resultado"). */
async function searchContribuinte(cnpj) {
  const searchInput = document.getElementById("FrmFisco:valorDaPesquisa_input") ?? document.getElementById("FrmFisco:valorDaPesquisa");
  if (!searchInput) throw new Error("CAMPO_BUSCA_CNPJ_NAO_ENCONTRADO");
  // InputMask — digita dígito por dígito via eventos de teclado, não seta o valor
  // mascarado direto (a lib insere a pontuação sozinha à medida que "digita").
  await typeIntoMaskedInput(searchInput, cnpj);
  note(`digitou ${cnpj} no campo (confirmado)`);

  const filtrarButton = findByExactText("button", "Filtrar") ?? [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Filtrar"));
  if (!filtrarButton) throw new Error("BOTAO_FILTRAR_NAO_ENCONTRADO");
  const tipoFiltro = document.getElementById("FrmFisco:filtroIeCnpjRazao_label")?.textContent.trim();
  note(`antes de clicar: campo="${searchInput.value}" tipo=${tipoFiltro}`);
  clearXhrLog();
  const loadingWatcher = watchLoadingOverlay();
  await realNavigationClick(filtrarButton);
  note("clicou Filtrar");
  await waitForAjaxIdle({ label: "AJAX da busca por CNPJ terminar" });
  note(`AJAX do Filtrar terminou (loading apareceu: ${loadingWatcher.stop() ? "sim" : "não"}; XHRs: ${describeXhrLog()})`);

  if (xhrCount() === 0 && filtrarButton.id) {
    // O clique real chegou na página (mousedown/click/submit recebidos) mas o onclick do
    // site não disparou a requisição — chama o onclick direto no mundo principal, capturando
    // a exceção pra saber por quê (e, se funcionar, o filtro segue normalmente).
    const probe = await chrome.runtime.sendMessage({ type: "CALL_ONCLICK", elementId: filtrarButton.id });
    note(`onclick chamado direto: ${JSON.stringify(probe?.result ?? probe)}`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    await waitForAjaxIdle({ label: "AJAX do Filtrar (onclick direto) terminar" });
    note(`após onclick direto: XHRs: ${describeXhrLog()}`);
  }

  const body = document.getElementById("FrmFisco:ListaContribuintes_data");
  if (body?.querySelector(".ui-datatable-empty-message")) {
    note("resultado: lista vazia");
    return null;
  }
  const row = body?.querySelector("tr") ?? null;
  note(`resultado: ${body?.querySelectorAll("tr").length ?? 0} linha(s), 1ª = ${row ? readRowCnpj(row) : "nenhuma"}`);
  return row;
}

function readRowCnpj(row) {
  return row.querySelectorAll("td")[1]?.textContent.trim().replace(/\D/g, "") ?? null;
}

async function handleListaContribuintes(run) {
  let row = await searchContribuinte(run.establishment.cnpj);
  // O campo de busca é um InputMask do PrimeFaces — setar o valor direto às vezes não
  // "gruda" da primeira vez (confirmado ao vivo, 2026-09-30: caiu na 1ª linha da lista
  // SEM filtro, não na empresa buscada). Nunca confia cegamente no resultado — sempre
  // confere o CNPJ da linha antes de clicar; se não bater, tenta buscar mais uma vez.
  if (row && readRowCnpj(row) !== run.establishment.cnpj) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    row = await searchContribuinte(run.establishment.cnpj);
    if (row && readRowCnpj(row) !== run.establishment.cnpj) {
      throw new Error(`BUSCA_NAO_FILTROU: esperava ${run.establishment.cnpj}, achou ${readRowCnpj(row)} na lista após 2 tentativas`);
    }
  }

  if (!row) {
    if (run.discovery) {
      // Não é essa procuração — pede pro background tentar a próxima da fila (history.back() + reclique).
      await chrome.runtime.sendMessage({ type: "DISCOVERY_NOT_FOUND" });
      return;
    }
    throw new Error(`EMPRESA_NAO_ENCONTRADA_NA_PROCURACAO: ${run.establishment.cnpj}`);
  }
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
  // Clica na 1ª célula, não no centro da <tr> inteira — a tabela tem várias
  // colunas (CNPJ, IE, Razão Social, Situação...) e pode ser mais larga que a
  // janela visível; o centro horizontal da linha caiu fora da área visível
  // pelo menos uma vez ao vivo (clique via CDP sem nenhum efeito, mesmo com
  // coordenadas "válidas" — rect não-zero, mas fora do viewport).
  await realNavigationClick(row.querySelector("td") ?? row);
  note("clicou na linha da empresa");
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
  await realNavigationClick(tabLink);
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
    if (situacaoLink) await realNavigationClick(situacaoLink);
    // dá um tempo pro download disparar e o background capturar; se em vez disso
    // abrir um modal (nosso mapeamento de texto errou), lê o modal e reclassifica.
    const dialog = await waitFor(() => {
      const el = [...document.querySelectorAll(".ui-dialog")].find((d) => d.offsetParent && d.textContent.includes("Solicitação de Extração"));
      return el ?? null;
    }, { timeoutMs: 4000, label: "modal de resultado da solicitação aparecer" }).catch(() => null);
    if (dialog) {
      const realStatus = classifySituacao(dialog.textContent);
      const fechar = findByExactText("button", "Fechar", dialog) ?? dialog.querySelector("button");
      if (fechar) await realNavigationClick(fechar);
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
  await realNavigationClick(radio ?? target);
}

async function fillAndSubmitExtractionForm(run) {
  const mesesRadio = document.getElementById("FrmSolicitarExtracaoDfe:tpPesquisaDM:1");
  if (!mesesRadio.checked) {
    await realNavigationClick(mesesRadio);
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
  await realNavigationClick(docRadio);
  await waitForAjaxIdle({ label: "AJAX popular PARTICIPA DO DOCUMENTO COMO" });

  await selectParticipante(PARTICIPANTE_LABEL[run.papel]);

  const confirmar = document.getElementById("FrmSolicitarExtracaoDfe:submitPesquisa");
  if (!confirmar) throw new Error("BOTAO_CONFIRMAR_EXTRACAO_NAO_ENCONTRADO");
  await realNavigationClick(confirmar);
  await waitFor(() => location.pathname.includes("mainAbasContribuinte"), { timeoutMs: 15000, label: "navegação de volta após confirmar solicitação de extração" });
}

// ---------- Orquestração ----------
(async () => {
  // Evita o ReferenceError: options is not defined do próprio Fisco Fácil
  // (confirmado ao vivo, 2026-09-30) — precisa rodar ANTES de qualquer
  // clique nesta página. Ver comentário de `ensurePageGlobals` em background.js.
  await chrome.runtime.sendMessage({ type: "ENSURE_PAGE_GLOBALS" }).catch(() => {});

  const certificado = readCertificateHolderName();
  const { empresa, cnpj } = readSelectedCompany();
  if (certificado || empresa || cnpj) await setConnectionStatus({ certificado, empresa, cnpj });

  const run = await getActiveRun();
  if (!run) return;

  if (runExpired(run)) {
    await reportFailure(`RUN_EXPIRADO: mais de ${Math.round((Date.now() - run.startedAt) / 1000)}s sem terminar — provavelmente travou silenciosamente numa espera interrompida por um reload.`);
    return;
  }

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
