// Service worker (MV3, módulo). Único lugar que fala com o backend do
// leitorxml — os content scripts só mexem no DOM do Fisco Fácil e mandam
// mensagens pra cá. Estado da execução em andamento fica em
// chrome.storage.session (sobrevive a navegação de página, não a reinício
// do navegador) sob a chave "activeRun".

const HOME_URL = "https://ssacert.fazenda.rj.gov.br/ssa/certificadoWeb";

// chrome.storage.session só é acessível de contextos confiáveis (páginas da
// extensão/service worker) por padrão — content scripts levam "Access to
// storage is not allowed from this context" até isto ser liberado. Precisa
// rodar toda vez que o service worker acorda (não persiste sozinho).
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => {});

/**
 * "Voltar" no histórico, mas garantindo carregamento real da página — às
 * vezes o Chrome restaura do bfcache em vez de recarregar de verdade, e
 * scripts do próprio Fisco Fácil que só rodam num load fresco (ex.: a
 * função `janela`, usada por `chamaAplicacao`) ficam indefinidos, quebrando
 * o próximo clique (confirmado ao vivo, 2026-09-30: "ReferenceError: janela
 * is not defined"). `pageshow` com `persisted:true` é o sinal padrão de
 * restauração via bfcache — força reload nesse caso.
 */
async function goBackWithFreshLoad(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      window.addEventListener(
        "pageshow",
        (event) => {
          if (event.persisted) location.reload();
        },
        { once: true },
      );
      history.back();
    },
  });
}

/**
 * Clique de verdade via Chrome DevTools Protocol (Input.dispatchMouseEvent),
 * não `dispatchEvent()` — o navegador só conta isso como "ativação de
 * usuário" real quando vem do CDP (ou de um gesto humano de fato). Exige a
 * permissão "debugger" e mostra a barra "está depurando este navegador"
 * enquanto anexado — por isso desanexa (`detach`) logo depois de clicar.
 */
async function dispatchRealClick(tabId, x, y) {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

/**
 * Digitação real via CDP (Input.insertText) — dispatchEvent(KeyboardEvent) na
 * própria página não funciona em campos "InputMask" (confirmado ao vivo,
 * 2026-09-30: o campo de busca ficou completamente vazio, a lib nem reagiu
 * aos eventos sintéticos). Input.insertText passa pela inserção nativa de
 * texto do navegador de verdade — o elemento alvo precisa já estar focado
 * (o content script chama `.focus()` antes de mandar a mensagem).
 */
async function dispatchRealType(tabId, text) {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text });
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

/**
 * Pré-define `window.options` no MUNDO PRINCIPAL da página (não no mundo
 * isolado do content script) — bug real do próprio Fisco Fácil confirmado
 * ao vivo em 2026-09-30 via DevTools: o onclick do botão "Filtrar" (e
 * provavelmente outros — é um template genérico do PrimeFaces reusado em
 * vários botões) chama `PrimeFaces.bcn(this, event, [function(event){
 * showLoading(options)}, function(event){ /* AJAX de verdade *\/ }])`, e
 * `options` nunca é declarado em `principalContribuintes.xhtml` — estoura
 * `ReferenceError: options is not defined` DENTRO da cadeia do PrimeFaces,
 * abortando antes da 2ª função (a que de fato dispara o AJAX) rodar. O
 * clique "funciona" do nosso lado (CDP não erra), mas nada acontece na
 * tela. `chrome.scripting.executeScript({world:"MAIN"})` roda no contexto
 * de JS da própria página (diferente de uma `<script>` injetada via DOM,
 * que a CSP da página bloquearia) e não precisa de nenhuma permissão além
 * de "scripting", que já temos.
 */
async function ensurePageGlobals(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      // string vazia, não objeto: showLoading(options) → getContainer(source) faz
      // `(source || "").split(...)`, que quebra com TypeError se `source` for um objeto
      // (confirmado ao vivo, 2026-10-02, com `window.options = {}`).
      window.options = window.options ?? "";

      // Registro read-only das requisições XHR do site (PrimeFaces AJAX), lido
      // pelo content script via document.documentElement.dataset — única forma
      // de saber se um clique realmente disparou uma requisição e o que foi
      // enviado/atualizado, já que o mundo isolado não enxerga XHR da página.
      if (window.__leitorxmlXhrHooked) return;
      window.__leitorxmlXhrHooked = true;
      const root = document.documentElement;
      const KEYS = ["javax.faces.source", "javax.faces.partial.execute", "javax.faces.partial.render", "FrmFisco:valorDaPesquisa", "FrmFisco:filtroIeCnpjRazao_input"];
      let seq = 0;
      const readLog = () => {
        try {
          return JSON.parse(root.dataset.leitorxmlXhr || "[]");
        } catch {
          return [];
        }
      };
      const writeLog = (log) => {
        root.dataset.leitorxmlXhr = JSON.stringify(log.slice(-10));
      };
      // Cliques/submits que a página de fato recebe (alvo e se é "trusted") — separa
      // "o clique do CDP não chegou/caiu em outro elemento" de "chegou mas o onclick não rodou".
      const logEvent = (event) => {
        const el = event.target;
        let log = [];
        try {
          log = JSON.parse(root.dataset.leitorxmlEvents || "[]");
        } catch {}
        log.push({ type: event.type, tag: el?.tagName, id: el?.id || undefined, cls: String(el?.className ?? "").slice(0, 40), trusted: event.isTrusted });
        root.dataset.leitorxmlEvents = JSON.stringify(log.slice(-10));
      };
      for (const type of ["mousedown", "click", "submit"]) document.addEventListener(type, logEvent, true);
      // Erros da página capturados DENTRO do mundo principal (não dá pra ter certeza
      // de que o "error" do mundo isolado enxerga exceções daqui).
      window.addEventListener("error", (event) => {
        let log = [];
        try {
          log = JSON.parse(root.dataset.leitorxmlErrors || "[]");
        } catch {}
        log.push(`${event.message} (${String(event.filename ?? "").split("/").pop()}:${event.lineno})`);
        root.dataset.leitorxmlErrors = JSON.stringify(log.slice(-5));
      });
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__lx = { method, url: String(url).split("?")[0].split("/").pop() };
        return originalOpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function (body) {
        const id = ++seq;
        const params = {};
        try {
          const search = new URLSearchParams(typeof body === "string" ? body : "");
          for (const key of KEYS) if (search.has(key)) params[key] = search.get(key);
        } catch {}
        writeLog([...readLog(), { id, ...this.__lx, params, status: "pendente" }]);
        this.addEventListener("loadend", () => {
          let text = "";
          try {
            text = this.responseText;
          } catch {}
          const updates = [...text.matchAll(/<update id="([^"]+)"/g)].map((match) => match[1]).slice(0, 6);
          writeLog(readLog().map((entry) => (entry.id === id ? { ...entry, status: this.status, updates } : entry)));
        });
        return originalSend.call(this, body);
      };
    },
  });
}

async function getSettings() {
  const { apiBaseUrl, apiToken } = await chrome.storage.local.get(["apiBaseUrl", "apiToken"]);
  return { apiBaseUrl: apiBaseUrl || "http://localhost:3003/leitorxml", apiToken: apiToken || null };
}

async function apiFetch(path, options = {}) {
  const { apiBaseUrl, apiToken } = await getSettings();
  if (!apiToken) throw new Error("SEM_TOKEN_CONFIGURADO");
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers ?? {}), Authorization: `Bearer ${apiToken}` },
  });
  if (!response.ok) throw new Error(`API_ERROR_${response.status}`);
  return response;
}

async function getActiveRun() {
  const { activeRun } = await chrome.storage.session.get("activeRun");
  return activeRun ?? null;
}

async function setActiveRun(run) {
  await chrome.storage.session.set({ activeRun: run });
}

async function clearActiveRun() {
  await chrome.storage.session.remove("activeRun");
}

/** Busca a próxima tarefa e prepara a corrida: decide se dá pra continuar na mesma empresa (economiza navegação) ou se precisa voltar pra Página Principal e reentrar por procuração. */
async function claimNextTaskAndPrepare() {
  const previousRun = await getActiveRun();
  const response = await apiFetch("/api/leitorxml/extensao/proxima-tarefa");
  const { task, establishment, accessContext } = await response.json();
  if (!task) {
    await clearActiveRun();
    return null;
  }

  const sameEstablishment = previousRun?.establishment?.cnpj === establishment.cnpj;
  const run = {
    taskId: task.id,
    tipoDocumento: task.tipoDocumento,
    papel: task.papel,
    competenciaAno: task.competenciaAno,
    competenciaMes: task.competenciaMes,
    establishment,
    accessContext,
    // Se já estamos na mesma empresa (acabamos de terminar outro combo dela), pula direto pro formulário —
    // sem sair da sessão, sem reentrar por procuração. Só navega do zero se for empresa nova.
    step: sameEstablishment ? "ON_ESTABLISHMENT" : "NAVIGATE_HOME",
    // Vigia de corrida travada: se a página recarregar no meio de uma espera
    // (`waitFor`), a promise pendente some junto com o contexto antigo — nada
    // é reportado, nem sucesso nem falha, e a tarefa fica presa em
    // AUTENTICANDO pra sempre (visto ao vivo várias vezes, 2026-09-30). Cada
    // content script confere isso ao carregar (ver `checkRunNotExpired` em
    // dom-utils.js) e falha alto se a corrida já passou do tempo esperado,
    // em vez de ficar presa silenciosamente até alguém notar e resetar no banco.
    startedAt: Date.now(),
  };
  await setActiveRun(run);

  if (!sameEstablishment) {
    const [tab] = await chrome.tabs.query({ url: "https://ssacert.fazenda.rj.gov.br/*" });
    if (tab) await chrome.tabs.update(tab.id, { active: true, url: HOME_URL });
    else await chrome.tabs.create({ url: HOME_URL });
  } else {
    // mesma página, só avisa o content script já carregado pra prosseguir.
    const [tab] = await chrome.tabs.query({ url: "https://fisco-facil.fazenda.rj.gov.br/*", active: true });
    if (tab) chrome.tabs.sendMessage(tab.id, { type: "RUN_STEP" }).catch(() => {});
  }
  return run;
}

/**
 * Varredura completa: entra em CADA procuração do modal, lê todas as páginas
 * da lista de empresas, e cadastra/cria tarefa pra cada uma que não for
 * "Baixada" — sem depender de estabelecimentos pré-cadastrados no Portal.
 * Fase separada da execução (REQUEST_NEXT_TASK continua sendo quem processa
 * as tarefas já criadas, uma de cada vez).
 */
async function startSweep() {
  const run = { mode: "SWEEP", step: "NAVIGATE_HOME", startedAt: Date.now() };
  await setActiveRun(run);
  const [tab] = await chrome.tabs.query({ url: "https://ssacert.fazenda.rj.gov.br/*" });
  if (tab) await chrome.tabs.update(tab.id, { active: true, url: HOME_URL });
  else await chrome.tabs.create({ url: HOME_URL });
  return run;
}

async function reportEvento(taskId, body) {
  await apiFetch(`/api/leitorxml/extensao/tarefas/${taskId}/eventos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function reportFalha(taskId, motivo) {
  // O backend recusa (400) motivo > 4000 chars e a falha sumiria sem rastro,
  // deixando a tarefa presa em AUTENTICANDO (visto ao vivo, 2026-10-02).
  await apiFetch(`/api/leitorxml/extensao/tarefas/${taskId}/falha`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motivo: motivo.slice(0, 3900) }),
  });
  await clearActiveRun();
}

async function reportProcuracaoIndice(entries) {
  await apiFetch("/api/leitorxml/extensao/procuracao-indice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
}

/** Reenvia (via fetch) a URL que o Chrome resolveu pro download disparado ao clicar num resultado pronto, pra pegar os bytes direto em memória — sem depender de ler arquivo do disco. */
async function captureDownloadForTask(downloadItem, taskId) {
  const response = await fetch(downloadItem.finalUrl || downloadItem.url, { credentials: "include" });
  const blob = await response.blob();
  const form = new FormData();
  form.append("file", blob, "extracao.zip");
  const { apiBaseUrl, apiToken } = await getSettings();
  const uploadResponse = await fetch(`${apiBaseUrl}/api/leitorxml/extensao/tarefas/${taskId}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}` },
    body: form,
  });
  if (!uploadResponse.ok) throw new Error(`UPLOAD_FAILED_${uploadResponse.status}`);
  await chrome.downloads.erase({ id: downloadItem.id });
  await clearActiveRun();
}

let expectedDownloadTaskId = null;

chrome.downloads.onCreated.addListener((item) => {
  if (!expectedDownloadTaskId) return;
  // Um download apareceu enquanto esperávamos um — cancela o salvamento nativo
  // (já vamos buscar os bytes via fetch) e captura pro backend.
  const taskId = expectedDownloadTaskId;
  expectedDownloadTaskId = null;
  chrome.downloads.search({ id: item.id }).then(([full]) => {
    captureDownloadForTask(full ?? item, taskId).catch((error) => {
      reportFalha(taskId, `Falha ao capturar o ZIP baixado: ${error.message}`).catch(() => {});
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "REQUEST_NEXT_TASK": {
          // Evita clicar "Buscar próxima tarefa" de novo em cima de uma corrida ainda em
          // andamento — isso reivindicava outra tarefa sem liberar a trava da anterior,
          // deixando estabelecimentos travados abandonados pra trás (confirmado ao vivo,
          // 2026-09-30). Só permite se não houver activeRun, ou se `force: true` vier explícito.
          const existing = await getActiveRun();
          if (existing && !message.force) {
            sendResponse({ ok: false, error: "JA_TEM_TAREFA_EM_ANDAMENTO", run: existing });
            break;
          }
          const run = await claimNextTaskAndPrepare();
          sendResponse({ ok: true, run });
          break;
        }
        case "REPORT_STATUS": {
          const run = await getActiveRun();
          if (!run) return sendResponse({ ok: false, error: "NO_ACTIVE_RUN" });
          await reportEvento(run.taskId, {
            status: message.status,
            ...(message.sefazReferencia ? { sefazReferencia: message.sefazReferencia } : {}),
            ...(message.sefazPrevisaoConclusao ? { sefazPrevisaoConclusao: message.sefazPrevisaoConclusao } : {}),
          });
          if (["SEM_DOCUMENTOS", "EXPIRADA"].includes(message.status)) await clearActiveRun();
          sendResponse({ ok: true });
          break;
        }
        case "REPORT_FAILURE": {
          const run = await getActiveRun();
          if (run) await reportFalha(run.taskId, message.motivo);
          sendResponse({ ok: true });
          break;
        }
        case "REPORT_PROCURACAO_INDEX": {
          await reportProcuracaoIndice(message.entries);
          sendResponse({ ok: true });
          break;
        }
        case "REAL_CLICK": {
          // Clique sintético (dispatchEvent) e chamar funções globais direto no mundo
          // principal falham silenciosamente pra cliques que dependem de navegação
          // real de página (entrar numa empresa, entrar numa procuração) — confirmado
          // ao vivo, 2026-09-30: só um clique com "ativação de usuário" real navega de
          // forma confiável. chrome.debugger dispara um clique via CDP que conta como
          // gesto real. Usa a aba que mandou a mensagem (sender.tab), não uma busca por
          // URL — funciona tanto em ssacert.fazenda quanto em fisco-facil.
          if (!sender.tab) return sendResponse({ ok: false, error: "SEM_ABA_REMETENTE" });
          try {
            await dispatchRealClick(sender.tab.id, message.x, message.y);
            sendResponse({ ok: true });
          } catch (error) {
            sendResponse({ ok: false, error: `REAL_CLICK_FALHOU: ${error.message} (se o DevTools estiver aberto nessa aba, chrome.debugger não consegue anexar — feche o F12 e tente de novo)` });
          }
          break;
        }
        case "REAL_TYPE": {
          // Mesmo motivo do REAL_CLICK — campos "InputMask" não reagem a eventos de
          // teclado sintéticos da página. O elemento já precisa estar focado.
          if (!sender.tab) return sendResponse({ ok: false, error: "SEM_ABA_REMETENTE" });
          try {
            await dispatchRealType(sender.tab.id, message.text);
            sendResponse({ ok: true });
          } catch (error) {
            sendResponse({ ok: false, error: `REAL_TYPE_FALHOU: ${error.message} (se o DevTools estiver aberto nessa aba, chrome.debugger não consegue anexar — feche o F12 e tente de novo)` });
          }
          break;
        }
        case "SET_DISCOVERY_QUEUE": {
          // content-home.js enumerou as posições do modal — guarda a fila e o cursor no activeRun.
          const run = await getActiveRun();
          if (!run) return sendResponse({ ok: false, error: "NO_ACTIVE_RUN" });
          const discovery = { queue: message.queue, cursor: 0 };
          await setActiveRun({ ...run, discovery });
          sendResponse({ ok: true, discovery });
          break;
        }
        case "DISCOVERY_FOUND": {
          // O CNPJ apareceu na posição sendo testada — cacheia no índice e segue o fluxo normal a partir daqui.
          const run = await getActiveRun();
          if (!run) return sendResponse({ ok: false, error: "NO_ACTIVE_RUN" });
          await reportProcuracaoIndice([
            {
              procuracaoGrupo: message.grupo,
              posicao: message.posicao,
              cnpj: run.establishment.cnpj,
              situacaoCadastral: run.establishment.situacaoCadastral || "Habilitada",
            },
          ]);
          await setActiveRun({ ...run, accessContext: { type: "PROCURACAO", grupo: message.grupo, posicao: message.posicao }, discovery: null });
          sendResponse({ ok: true });
          break;
        }
        case "DISCOVERY_NOT_FOUND": {
          // Não é essa posição — avança o cursor e volta pro histórico pra content-home.js testar a próxima.
          const run = await getActiveRun();
          if (!run?.discovery) return sendResponse({ ok: false, error: "NO_DISCOVERY_IN_PROGRESS" });
          const nextCursor = run.discovery.cursor + 1;
          if (nextCursor >= run.discovery.queue.length) {
            await reportFalha(run.taskId, `CNPJ ${run.establishment.cnpj} não encontrado em nenhuma das ${run.discovery.queue.length} procurações testadas.`);
            sendResponse({ ok: true, done: true });
            break;
          }
          await setActiveRun({ ...run, discovery: { ...run.discovery, cursor: nextCursor } });
          const [tab] = await chrome.tabs.query({ url: "https://fisco-facil.fazenda.rj.gov.br/*", active: true });
          if (tab) await goBackWithFreshLoad(tab.id);
          sendResponse({ ok: true });
          break;
        }
        case "START_SWEEP": {
          const run = await startSweep();
          sendResponse({ ok: true, run });
          break;
        }
        case "SET_SWEEP_QUEUE": {
          // content-home.js enumerou TODAS as procurações do modal (todos os grupos) — guarda a fila e o cursor.
          const run = await getActiveRun();
          if (!run) return sendResponse({ ok: false, error: "NO_ACTIVE_RUN" });
          await setActiveRun({ ...run, sweepQueue: message.queue, sweepCursor: 0 });
          sendResponse({ ok: true, queue: message.queue });
          break;
        }
        case "REGISTER_ESTABLISHMENT": {
          // Uma linha não-Baixada foi lida da lista — cadastra/atualiza e cria as tarefas do mês, sem bloquear a varredura por muito tempo.
          const response = await apiFetch("/api/leitorxml/extensao/estabelecimentos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cnpj: message.cnpj,
              razaoSocial: message.razaoSocial,
              inscricaoEstadual: message.inscricaoEstadual,
              situacaoCadastral: message.situacaoCadastral,
              procuracaoGrupo: message.procuracaoGrupo,
              posicao: message.posicao,
            }),
          });
          sendResponse({ ok: true, result: await response.json() });
          break;
        }
        case "SWEEP_NEXT_POSITION": {
          // Esgotou as páginas da procuração atual — avança o cursor e volta pro histórico pra testar a próxima.
          const run = await getActiveRun();
          if (!run) return sendResponse({ ok: false, error: "NO_ACTIVE_RUN" });
          const nextCursor = (run.sweepCursor ?? 0) + 1;
          if (nextCursor >= run.sweepQueue.length) {
            await clearActiveRun();
            sendResponse({ ok: true, done: true });
            break;
          }
          await setActiveRun({ ...run, sweepCursor: nextCursor });
          const [tab] = await chrome.tabs.query({ url: "https://fisco-facil.fazenda.rj.gov.br/*", active: true });
          if (tab) await goBackWithFreshLoad(tab.id);
          sendResponse({ ok: true });
          break;
        }
        case "REPORT_SWEEP_FAILURE": {
          await chrome.storage.session.set({ lastSweepError: message.motivo });
          await clearActiveRun();
          sendResponse({ ok: true });
          break;
        }
        case "SWEEP_DONE": {
          await chrome.storage.session.remove("lastSweepError");
          await clearActiveRun();
          sendResponse({ ok: true });
          break;
        }
        case "EXPECT_DOWNLOAD": {
          const run = await getActiveRun();
          if (run) expectedDownloadTaskId = run.taskId;
          sendResponse({ ok: true });
          break;
        }
        case "CALL_ONCLICK": {
          // Chama o onclick inline do elemento direto no mundo principal, devolvendo
          // a exceção se houver — separa "o onclick do site quebra" de "o clique não chegou".
          if (!sender.tab) return sendResponse({ ok: false, error: "SEM_ABA_REMETENTE" });
          const [injection] = await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            world: "MAIN",
            args: [message.elementId],
            func: (elementId) => {
              const element = document.getElementById(elementId);
              if (!element || typeof element.onclick !== "function") return { called: false, reason: element ? "sem onclick" : "elemento não encontrado" };
              try {
                const result = element.onclick(new MouseEvent("click", { bubbles: true, cancelable: true }));
                return { called: true, returned: String(result) };
              } catch (error) {
                return {
                  called: true,
                  threw: `${error?.name}: ${error?.message}`,
                  stack: String(error?.stack ?? "").split("\n").slice(0, 3).join(" | ").slice(0, 300),
                  showLoadingSrc: typeof window.showLoading === "function" ? String(window.showLoading).slice(0, 500) : "showLoading não é global",
                };
              }
            },
          });
          sendResponse({ ok: true, result: injection?.result });
          break;
        }
        case "ENSURE_PAGE_GLOBALS": {
          if (!sender.tab) return sendResponse({ ok: false, error: "SEM_ABA_REMETENTE" });
          await ensurePageGlobals(sender.tab.id);
          sendResponse({ ok: true });
          break;
        }
        case "GET_ACTIVE_RUN": {
          sendResponse({ ok: true, run: await getActiveRun() });
          break;
        }
        default:
          sendResponse({ ok: false, error: "UNKNOWN_MESSAGE_TYPE" });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  })();
  return true; // resposta assíncrona
});
