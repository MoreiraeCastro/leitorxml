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

// Vigia do service worker: uma corrida por-tarefa leva ~30s; passando de RUN_STALL_MS sem terminar,
// está parada (visto ao vivo, 2026-10-02: tarefas presas em AUTENTICANDO sem nenhum erro). Diferente
// do `runExpired` dos content scripts, não depende de uma página recarregar pra disparar.
const RUN_STALL_MS = 3 * 60 * 1000;
const TRACK_STALL_MS = 8 * 60 * 1000; // visita a uma empresa pode incluir vários downloads de ZIP
chrome.alarms.create("run-watchdog", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === AUTO_TRACK_ALARM) {
    await maybeAutoTrack().catch((error) => setAutoStatus({ state: "ERRO", message: error.message }));
    return;
  }
  if (alarm.name !== "run-watchdog") return;
  const run = await getActiveRun();
  if (!run || run.mode === "SWEEP" || typeof run.startedAt !== "number") return;
  if (run.mode === "TRACK") {
    if (Date.now() - run.startedAt < (run.verifyOnly ? RUN_STALL_MS : TRACK_STALL_MS)) return;
    const { lastNote } = await chrome.storage.session.get("lastNote");
    await failActiveRun(run, `ACOMPANHAMENTO_TRAVADO em ${run.establishment?.razaoSocial}: ${Math.round((Date.now() - run.startedAt) / 1000)}s sem terminar; último passo: "${lastNote?.step ?? "nenhum"}" em ${lastNote?.path ?? "?"}`);
    return;
  }
  if (!run.taskId) return;
  if (Date.now() - run.startedAt < RUN_STALL_MS) return;
  if (run.formSubmitted) {
    // A solicitação já foi criada e registrada como SOLICITADO — só o encadeamento parou. Não derruba a tarefa;
    // a esteira segue pra próxima.
    await beltOnSuccess(await findWorkTabId(), run).catch(() => clearActiveRun());
    return;
  }
  const { lastNote } = await chrome.storage.session.get("lastNote");
  const onde = lastNote ? `último passo: "${lastNote.step}" em ${lastNote.path}, ${Math.round((Date.now() - lastNote.at) / 1000)}s atrás` : "sem passo registrado";
  await failActiveRun(run, `RUN_TRAVADA: ${Math.round((Date.now() - run.startedAt) / 1000)}s sem terminar nem reportar falha; ${onde}`, await findWorkTabId()).catch(() => {});
});

/** Busca a próxima tarefa e prepara a corrida: decide se dá pra continuar na mesma empresa (economiza navegação) ou se precisa voltar pra Página Principal e reentrar por procuração. */
// ---------- Esteira de solicitações ----------
// Um clique em "Iniciar esteira" processa a fila inteira: as 3 combinações de uma empresa e, quando acabam,
// a próxima empresa, até não sobrar nada. Cada tarefa cria uma solicitação REAL na SEFAZ, então a esteira
// tem proteções: falha de uma tarefa não derruba a esteira (segue pra próxima), mas N falhas SEGUIDAS
// (problema geral: sessão caída, site fora do ar, certificado) param tudo; e dá pra parar a pedido.
const BELT_MAX_CONSECUTIVE_FAILURES = 3;
const BELT_HARD_CAP = 1500;

async function getBelt() {
  const { belt } = await chrome.storage.session.get("belt");
  return belt ?? null;
}
async function setBelt(belt) {
  await chrome.storage.session.set({ belt });
}
async function endBelt(summary) {
  const belt = (await getBelt()) ?? {};
  await setBelt({ ...belt, active: false, summary, finishedAt: Date.now() });
  if (belt.auto) await setAutoStatus({ state: "CONCLUIDO", message: summary, problem: (belt.failed ?? 0) > 0 || /interromp/i.test(summary) });
}

// ---------- Acompanhamento automático ----------
// Pensado pra quem opera sem saber de tecnologia: com o Chrome aberto e o Fisco Fácil logado, a cada ~20 min a
// extensão pergunta ao backend se há algo a baixar/conferir e, havendo, roda sozinha a mesma esteira do botão
// "Conferir resultados e baixar ZIPs". Só LÊ e baixa — nunca cria solicitação nova. Não consegue logar sozinha
// (o acesso é por certificado): sem aba do Fisco Fácil aberta, avisa com um "!" no ícone em vez de tentar.
const AUTO_TRACK_ALARM = "auto-track";
const AUTO_TRACK_STALE_HOURS = 12; // uma solicitação "aguardando" só é reconferida depois disso (o SEFAZ leva dias)
const AUTO_TRACK_FROM_HOUR = 7; // seg–sex, horário local do PC
const AUTO_TRACK_TO_HOUR = 20;
chrome.alarms.get(AUTO_TRACK_ALARM).then((alarm) => {
  if (!alarm) chrome.alarms.create(AUTO_TRACK_ALARM, { delayInMinutes: 2, periodInMinutes: 20 });
});

async function setAutoStatus(status) {
  await chrome.storage.local.set({ autoTrack: { ...status, at: Date.now() } });
  const needsAttention = status.state === "PRECISA_ABRIR_FISCO" || status.state === "ERRO" || Boolean(status.problem);
  await chrome.action.setBadgeText({ text: needsAttention ? "!" : "" }).catch(() => {});
  if (needsAttention) await chrome.action.setBadgeBackgroundColor({ color: "#c0392b" }).catch(() => {});
}

async function maybeAutoTrack({ ignoreSchedule = false } = {}) {
  const { autoTrackEnabled = true } = await chrome.storage.local.get("autoTrackEnabled");
  if (!autoTrackEnabled) return setAutoStatus({ state: "DESLIGADO" });
  const now = new Date();
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  if (!ignoreSchedule && (weekend || now.getHours() < AUTO_TRACK_FROM_HOUR || now.getHours() >= AUTO_TRACK_TO_HOUR)) return setAutoStatus({ state: "FORA_DO_HORARIO" });
  if ((await getActiveRun()) || (await getBelt())?.active) return; // já tem esteira rodando: não interrompe
  const { apiToken } = await getSettings();
  if (!apiToken) return setAutoStatus({ state: "ERRO", message: "Token do backend não configurado na extensão." });
  const summary = await (await apiFetch(`/api/leitorxml/extensao/acompanhamento/resumo?staleHours=${AUTO_TRACK_STALE_HOURS}`)).json();
  if (summary.paraBaixar + summary.aConferir === 0) return setAutoStatus({ state: "NADA_A_FAZER", summary });
  const tabId = await findWorkTabId();
  if (tabId == null) return setAutoStatus({ state: "PRECISA_ABRIR_FISCO", summary });
  await setAutoStatus({ state: "RODANDO", summary });
  const outcome = await startTrackingBelt({ tabId, auto: true });
  if (!outcome.ok) await setAutoStatus({ state: "ERRO", message: outcome.error });
}

/** Começa a esteira de acompanhamento (botão do popup ou automático). */
async function startTrackingBelt({ tabId, auto = false }) {
  const existing = await getActiveRun();
  if (existing) return { ok: false, error: "JA_TEM_TAREFA_EM_ANDAMENTO", run: existing };
  await chrome.storage.session.remove("lastSweepError");
  await setBelt({ kind: "TRACK", active: true, auto, staleHours: auto ? AUTO_TRACK_STALE_HOURS : null, processed: 0, failed: 0, failures: 0, stopRequested: false, startedAt: Date.now() });
  if (!auto) await setAutoStatus({ state: "MANUAL" });
  const first = await claimNextTrackingCompany([], 1, tabId);
  if (!first) await endBelt("Nenhuma solicitação pendente de conferência.");
  return { ok: true, run: first };
}

/** Uma aba do portal/Fisco Fácil, pra o vigia (que não tem `sender.tab`) poder navegar. */
async function findWorkTabId() {
  const [tab] = await chrome.tabs.query({ url: ["https://fisco-facil.fazenda.rj.gov.br/*", "https://ssacert.fazenda.rj.gov.br/*"] });
  return tab?.id ?? null;
}

/** A tarefa atual foi solicitada: conta e segue pra próxima (da mesma empresa se houver, senão a próxima empresa). Sem esteira ativa, só encerra a corrida. */
async function beltOnSuccess(tabId, previousRun) {
  const belt = await getBelt();
  if (!belt?.active || (belt.kind ?? "REQUEST") !== "REQUEST") {
    await finishBatchAndReturnHome(tabId);
    return { done: true };
  }
  const processed = belt.processed + 1;
  if (belt.stopRequested) {
    await endBelt(`Esteira parada a pedido: ${processed} tarefa(s) solicitada(s), ${belt.failed} falha(s).`);
    await setBelt({ ...(await getBelt()), processed });
    await finishBatchAndReturnHome(tabId);
    return { done: true };
  }
  if (processed >= BELT_HARD_CAP) {
    await endBelt(`Esteira parada no limite de segurança (${BELT_HARD_CAP} tarefas). Clique de novo para continuar.`);
    await setBelt({ ...(await getBelt()), processed });
    await finishBatchAndReturnHome(tabId);
    return { done: true };
  }
  await setBelt({ ...belt, processed, failures: 0 });
  const previousEstablishmentId = previousRun?.establishment?.id ?? null;
  const next = await claimNextTaskAndPrepare(1, previousEstablishmentId, tabId, { launch: false });
  if (next && next.establishment?.id === previousEstablishmentId) {
    await launchRun(next, tabId); // ainda tem combinação dessa empresa: segue sem sair dela
    return { done: false, run: next };
  }
  // Acabaram as tarefas dessa empresa: confere a aba Solicitações antes de sair dela.
  const verification = await startVerification(previousRun, tabId, next);
  if (verification) return { done: false, run: verification };
  if (next) {
    await launchRun(next, tabId);
    return { done: false, run: next };
  }
  await endBelt(`Fila concluída: ${processed} tarefa(s) solicitada(s), ${belt.failed} falha(s).`);
  await setBelt({ ...(await getBelt()), processed });
  await finishBatchAndReturnHome(tabId);
  return { done: true };
}

/** A tarefa atual falhou (já registrada no backend): a esteira segue pra próxima empresa, a menos que as falhas seguidas passem do limite. */
async function beltOnFailure(tabId, motivo) {
  const belt = await getBelt();
  if (!belt?.active || (belt.kind ?? "REQUEST") !== "REQUEST") return;
  const failures = belt.failures + 1;
  const failed = belt.failed + 1;
  if (belt.stopRequested || failures >= BELT_MAX_CONSECUTIVE_FAILURES) {
    await setBelt({ ...belt, failures, failed });
    await endBelt(`Esteira interrompida após ${failures} falha(s) seguida(s) (${belt.processed} solicitada(s) antes). Última: ${motivo}`.slice(0, 600));
    return;
  }
  await setBelt({ ...belt, failures, failed });
  try {
    const run = await claimNextTaskAndPrepare(1, null, tabId);
    if (!run) await endBelt(`Fila concluída: ${belt.processed} tarefa(s) solicitada(s), ${failed} falha(s).`);
  } catch (error) {
    await endBelt(`Esteira interrompida ao buscar a próxima tarefa: ${error.message}`);
  }
}

/** Leva a aba pra Página Principal do portal: a aba informada, senão uma já aberta no portal, senão uma nova. */
async function navigateToHome(preferredTabId) {
  if (preferredTabId != null) {
    await chrome.tabs.update(preferredTabId, { active: true, url: HOME_URL });
    return;
  }
  const [tab] = await chrome.tabs.query({ url: "https://ssacert.fazenda.rj.gov.br/*" });
  if (tab) await chrome.tabs.update(tab.id, { active: true, url: HOME_URL });
  else await chrome.tabs.create({ url: HOME_URL });
}

/** Reivindica a próxima empresa com solicitações a acompanhar e começa a corrida de acompanhamento nela. */
async function claimNextTrackingCompany(visited, count, tabId) {
  const belt = await getBelt();
  const params = new URLSearchParams();
  if (visited.length) params.set("exclude", visited.join(","));
  if (belt?.kind === "TRACK" && belt.staleHours != null) params.set("staleHours", String(belt.staleHours)); // automático: pula o que foi conferido há pouco
  const query = params.toString() ? `?${params}` : "";
  const { establishment, accessContext, tasks } = await (await apiFetch(`/api/leitorxml/extensao/acompanhamento${query}`)).json();
  if (!establishment) {
    await clearActiveRun();
    return null;
  }
  const run = { mode: "TRACK", step: "NAVIGATE_HOME", startedAt: Date.now(), establishment, accessContext, trackTasks: tasks, trackVisited: visited, trackCount: count };
  await setActiveRun(run);
  await navigateToHome(tabId);
  return run;
}

/** Fim do lote: limpa a corrida e volta a aba pra Página Principal do portal (onde fica o card "AUTO Fisco Fácil" / modal de procurações). */
async function finishBatchAndReturnHome(tabId) {
  await clearActiveRun();
  if (tabId != null) await chrome.tabs.update(tabId, { url: HOME_URL }).catch(() => {});
}

async function claimNextTaskAndPrepare(chainCount = 1, preferEstablishmentId = null, tabId = null, { launch = true } = {}) {
  const previousRun = await getActiveRun();
  // Ao encadear, prefere as tarefas pendentes da empresa em que já estamos (as 3 combinações em
  // sequência, sem voltar ao modal de procurações a cada solicitação).
  const query = preferEstablishmentId ? `?establishmentId=${encodeURIComponent(preferEstablishmentId)}` : "";
  const response = await apiFetch(`/api/leitorxml/extensao/proxima-tarefa${query}`);
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
    chainCount,
  };
  await setActiveRun(run);
  if (launch) await launchRun(run, tabId);
  return run;
}

/** Põe a corrida pra andar: empresa nova → volta pra Página Principal (reentra por procuração); mesma empresa → recarrega a aba onde já estamos. */
async function launchRun(run, tabId = null) {
  if (run.step === "NAVIGATE_HOME") {
    await navigateToHome(tabId);
    return;
  }
  const targetId = tabId ?? (await chrome.tabs.query({ url: "https://fisco-facil.fazenda.rj.gov.br/*", active: true }))[0]?.id;
  if (targetId != null) chrome.tabs.sendMessage(targetId, { type: "RUN_STEP" }).catch(() => {});
}

/**
 * A empresa terminou (ou a fila acabou): antes de sair, confere a aba Solicitações dela — acha cada
 * tarefa que acabamos de marcar SOLICITADO e registra a situação, SEM baixar nada. A próxima tarefa já
 * reivindicada fica guardada em `belt.resume` e a esteira a retoma quando a conferência termina.
 * Devolve a corrida de conferência, ou null se não há o que conferir (ou a consulta falhou).
 */
async function startVerification(previousRun, tabId, nextRun) {
  const establishmentId = previousRun?.establishment?.id;
  if (!establishmentId) return null;
  let tasks;
  let establishment;
  try {
    ({ tasks, establishment } = await (await apiFetch(`/api/leitorxml/extensao/acompanhamento?establishmentId=${encodeURIComponent(establishmentId)}`)).json());
  } catch {
    return null;
  }
  if (!establishment || !tasks?.length) return null;
  const belt = (await getBelt()) ?? {};
  await setBelt({ ...belt, resume: nextRun ?? null });
  const run = { mode: "TRACK", verifyOnly: true, step: "ON_ESTABLISHMENT", startedAt: Date.now(), establishment, trackTasks: tasks, trackVisited: [], trackCount: 1 };
  await setActiveRun(run);
  await launchRun(run, tabId);
  return run;
}

/** Uma empresa falhou no acompanhamento (não conseguiu entrar, travou...): registra e a passada segue pra próxima, a menos que as falhas seguidas passem do limite. */
async function trackBeltOnFailure(run, motivo, tabId) {
  const belt = await getBelt();
  if (!belt?.active || belt.kind !== "TRACK") return;
  const failures = belt.failures + 1;
  const failed = belt.failed + 1;
  await setBelt({ ...belt, failures, failed });
  if (belt.stopRequested || failures >= BELT_MAX_CONSECUTIVE_FAILURES) {
    await endBelt(`Conferência interrompida após ${failures} falha(s) seguida(s) (${belt.processed} empresa(s) conferida(s) antes). Última: ${motivo}`.slice(0, 600));
    return;
  }
  try {
    const visited = [...(run.trackVisited ?? []), run.establishment.id];
    const next = await claimNextTrackingCompany(visited, visited.length + 1, tabId);
    if (!next) await endBelt(`Conferência concluída: ${belt.processed} empresa(s) conferida(s), ${failed} falha(s).`);
  } catch (error) {
    await endBelt(`Conferência interrompida ao buscar a próxima empresa: ${error.message}`);
  }
}

/** A conferência da aba Solicitações acabou (ou foi pulada por falha): a esteira retoma a próxima tarefa já reivindicada, ou encerra se a fila acabou. */
async function resumeBeltAfterVerify(tabId) {
  const belt = await getBelt();
  const next = belt?.resume ?? null;
  if (belt) await setBelt({ ...belt, resume: null });
  if (!belt?.active) {
    await finishBatchAndReturnHome(tabId);
    return;
  }
  if (belt.stopRequested) {
    await endBelt(`Esteira parada a pedido: ${belt.processed} tarefa(s) solicitada(s), ${belt.failed} falha(s).`);
    await finishBatchAndReturnHome(tabId);
    return;
  }
  if (!next) {
    await endBelt(`Fila concluída: ${belt.processed} tarefa(s) solicitada(s), ${belt.failed} falha(s).`);
    await finishBatchAndReturnHome(tabId);
    return;
  }
  const run = { ...next, startedAt: Date.now() };
  await setActiveRun(run);
  await launchRun(run, tabId);
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

/** Só registra a falha da tarefa no backend (não mexe na corrida ativa) — usado no acompanhamento, onde uma tarefa falhar não encerra a visita à empresa. */
async function postFalha(taskId, motivo) {
  // O backend recusa (400) motivo > 4000 chars e a falha sumiria sem rastro,
  // deixando a tarefa presa em AUTENTICANDO (visto ao vivo, 2026-10-02).
  await apiFetch(`/api/leitorxml/extensao/tarefas/${taskId}/falha`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motivo: motivo.slice(0, 3900) }),
  });
}

async function reportFalha(taskId, motivo) {
  await postFalha(taskId, motivo);
  await clearActiveRun();
}

/** Falha da corrida ativa: no acompanhamento/varredura não há UMA tarefa (guarda o erro pro popup); na solicitação, falha a tarefa. */
async function failActiveRun(run, motivo, tabId = null) {
  if (run.mode === "TRACK" && run.verifyOnly) {
    // A conferência da aba Solicitações falhou/travou: registra, mas a esteira segue pra próxima empresa.
    await chrome.storage.session.set({ lastSweepError: `Conferência da aba Solicitações pulada (${run.establishment?.razaoSocial}): ${motivo}`.slice(0, 900) });
    await resumeBeltAfterVerify(tabId ?? (await findWorkTabId()));
    return;
  }
  if (run.mode === "TRACK" || run.mode === "SWEEP" || !run.taskId) {
    await chrome.storage.session.set({ lastSweepError: motivo.slice(0, 3900) });
    await clearActiveRun();
    if (run.mode === "TRACK") await trackBeltOnFailure(run, motivo, tabId ?? (await findWorkTabId()));
    return;
  }
  await reportFalha(run.taskId, motivo);
  await beltOnFailure(tabId ?? (await findWorkTabId()), motivo);
}

async function reportProcuracaoIndice(entries) {
  await apiFetch("/api/leitorxml/extensao/procuracao-indice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
}

/** Envia o ZIP de uma tarefa pro backend (valida assinatura "PK" antes — um HTML de erro não pode virar "arquivo coletado"). */
async function uploadTaskZip(taskId, bytes) {
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const preview = new TextDecoder().decode(bytes.slice(0, 120)).replace(/\s+/g, " ");
    throw new Error(`RESPOSTA_NAO_E_ZIP (${bytes.length} bytes): "${preview}"`);
  }
  const { apiBaseUrl, apiToken } = await getSettings();
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/zip" }), "extracao.zip");
  const response = await fetch(`${apiBaseUrl}/api/leitorxml/extensao/tarefas/${taskId}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}` },
    body: form,
  });
  if (!response.ok) throw new Error(`UPLOAD_FAILED_${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

/**
 * Clica (CDP) e captura os BYTES do ZIP na hora, interceptando a resposta de rede (Fetch domain,
 * estágio Response) — o download do Fisco Fácil provavelmente sai de um POST de formulário, e reabrir a
 * URL depois (chrome.downloads + refetch) devolveria outra coisa. Depois de enviar pro backend, bloqueia a
 * resposta pra o Chrome não salvar uma cópia solta na pasta Downloads. Devolve { ok, ... } sempre.
 */
async function captureDownloadViaCdp(tabId, x, y, taskId) {
  const seen = [];
  const state = { captured: false };
  let finish;
  const finished = new Promise((resolve) => (finish = resolve));

  const onEvent = async (source, method, params) => {
    if (source.tabId !== tabId || method !== "Fetch.requestPaused") return;
    const headerValue = (name) => params.responseHeaders?.find((header) => header.name.toLowerCase() === name)?.value ?? "";
    const disposition = headerValue("content-disposition");
    const type = headerValue("content-type");
    if (seen.length < 8) seen.push(`${params.responseStatusCode ?? "?"} ${type.slice(0, 40)} ${disposition.slice(0, 40)} ${String(params.request?.url ?? "").split("/").pop()?.slice(0, 40)}`);
    const looksLikeDownload = /attachment/i.test(disposition) || /zip|octet-stream/i.test(type);
    if (!looksLikeDownload || state.captured) {
      await chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
      return;
    }
    state.captured = true;
    try {
      const body = await chrome.debugger.sendCommand({ tabId }, "Fetch.getResponseBody", { requestId: params.requestId });
      const bytes = body.base64Encoded ? Uint8Array.from(atob(body.body), (char) => char.charCodeAt(0)) : new TextEncoder().encode(body.body);
      const uploaded = await uploadTaskZip(taskId, bytes);
      finish({ ok: true, bytes: bytes.length, uploaded });
    } catch (error) {
      finish({ ok: false, error: error.message });
    } finally {
      await chrome.debugger.sendCommand({ tabId }, "Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" }).catch(() => {});
    }
  };

  await chrome.debugger.attach({ tabId }, "1.3");
  chrome.debugger.onEvent.addListener(onEvent);
  try {
    await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Response" }] });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "DOWNLOAD_NAO_CAPTURADO_EM_60S" }), 60000));
    const result = await Promise.race([finished, timeout]);
    if (!result.ok && result.error?.startsWith("DOWNLOAD_NAO_CAPTURADO")) {
      const [latest] = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 });
      result.diag = `respostas vistas: [${seen.join(" | ")}]; último download do Chrome: ${latest ? `${latest.mime} ${String(latest.filename).split(/[\\/]/).pop()} ${latest.state}` : "nenhum"}`;
    }
    return result;
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    await chrome.debugger.sendCommand({ tabId }, "Fetch.disable").catch(() => {});
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
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
          await setBelt({ kind: "REQUEST", active: true, processed: 0, failed: 0, failures: 0, stopRequested: false, startedAt: Date.now() });
          await chrome.storage.session.remove("lastSweepError");
          const run = await claimNextTaskAndPrepare();
          if (!run) await endBelt("Nada pendente na fila.");
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
          // `taskId` evita que uma falha atrasada de uma página antiga derrube a corrida NOVA da esteira.
          if (run && (!message.taskId || run.taskId === message.taskId)) await failActiveRun(run, message.motivo, sender.tab?.id);
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
            await failActiveRun(run, `CNPJ ${run.establishment.cnpj} não encontrado em nenhuma das ${run.discovery.queue.length} procurações testadas.`, sender.tab?.id);
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
          if (run) expectedDownloadTaskId = message.taskId ?? run.taskId;
          sendResponse({ ok: true });
          break;
        }
        case "START_TRACKING": {
          sendResponse(await startTrackingBelt({ tabId: sender.tab?.id }));
          break;
        }
        case "AUTO_TRACK_NOW": {
          // Botão "Verificar agora" do popup: roda a decisão do automático na hora (respeitando as mesmas regras).
          await maybeAutoTrack({ ignoreSchedule: true }).catch((error) => setAutoStatus({ state: "ERRO", message: error.message }));
          sendResponse({ ok: true, status: (await chrome.storage.local.get("autoTrack")).autoTrack ?? null });
          break;
        }
        case "TRACK_NEXT_COMPANY": {
          const previous = await getActiveRun();
          if (!previous || previous.mode !== "TRACK") return sendResponse({ ok: false, error: "NO_TRACKING_RUN" });
          const visited = [...(previous.trackVisited ?? []), previous.establishment.id];
          const belt = await getBelt();
          const processed = (belt?.processed ?? 0) + 1;
          if (belt?.active) await setBelt({ ...belt, processed, failures: 0 });
          if (belt?.stopRequested || visited.length >= BELT_HARD_CAP) {
            await endBelt(`Conferência parada ${belt?.stopRequested ? "a pedido" : "no limite de segurança"}: ${processed} empresa(s) conferida(s), ${belt?.failed ?? 0} falha(s).`);
            await finishBatchAndReturnHome(sender.tab?.id);
            return sendResponse({ ok: true, done: true });
          }
          const run = await claimNextTrackingCompany(visited, visited.length + 1, sender.tab?.id);
          if (!run) {
            await endBelt(`Conferência concluída: ${processed} empresa(s) conferida(s), ${belt?.failed ?? 0} falha(s).`);
            await finishBatchAndReturnHome(sender.tab?.id);
          }
          sendResponse({ ok: true, done: !run, run });
          break;
        }
        case "TRACK_GO_BACK": {
          // Da página de detalhe da solicitação de volta pro painel da empresa (com reload de verdade, sem bfcache).
          if (sender.tab) await goBackWithFreshLoad(sender.tab.id);
          sendResponse({ ok: true });
          break;
        }
        case "TRACK_REPORT": {
          await reportEvento(message.taskId, { status: message.status, ...(message.sefazReferencia ? { sefazReferencia: message.sefazReferencia } : {}) });
          sendResponse({ ok: true });
          break;
        }
        case "TRACK_TASK_FAILURE": {
          await postFalha(message.taskId, message.motivo);
          sendResponse({ ok: true });
          break;
        }
        case "CAPTURE_DOWNLOAD_CLICK": {
          if (!sender.tab) return sendResponse({ ok: false, error: "SEM_ABA_REMETENTE" });
          sendResponse({ ok: true, result: await captureDownloadViaCdp(sender.tab.id, message.x, message.y, message.taskId) });
          break;
        }
        case "CHAIN_NEXT_TASK": {
          // A solicitação da tarefa atual já foi criada e registrada — a esteira segue pra próxima
          // (mesma empresa quando houver: pula a reentrada por procuração; senão, a próxima empresa).
          const previous = await getActiveRun();
          if (!previous) return sendResponse({ ok: false, error: "NO_ACTIVE_RUN" });
          const outcome = await beltOnSuccess(sender.tab?.id, previous);
          sendResponse({ ok: true, done: outcome.done, run: outcome.run ?? null });
          break;
        }
        case "BELT_VERIFY_DONE": {
          const current = await getActiveRun();
          if (!current?.verifyOnly) return sendResponse({ ok: false, error: "NO_VERIFICATION_RUN" });
          await resumeBeltAfterVerify(sender.tab?.id);
          sendResponse({ ok: true });
          break;
        }
        case "STOP_BELT": {
          const belt = await getBelt();
          if (!belt?.active) return sendResponse({ ok: true, wasActive: false });
          if (await getActiveRun()) {
            await setBelt({ ...belt, stopRequested: true });
          } else {
            await endBelt("Esteira parada a pedido.");
          }
          sendResponse({ ok: true, wasActive: true });
          break;
        }
        case "HIDE_LOADING":
        case "DESCRIBE_LOADING": {
          // O overlay #loading do site pode ficar preso visível depois do AJAX (visto ao vivo,
          // 2026-10-02) e cobrir o alvo do clique. HIDE_LOADING chama o hideLoading() do próprio
          // site; DESCRIBE_LOADING devolve o código das funções pra diagnóstico.
          if (!sender.tab) return sendResponse({ ok: false, error: "SEM_ABA_REMETENTE" });
          const [injection] = await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            world: "MAIN",
            args: [message.type],
            func: (kind) => {
              const source = (fn) => (typeof fn === "function" ? String(fn).slice(0, 600) : "não é função global");
              if (kind === "DESCRIBE_LOADING") {
                return {
                  show: source(window.showLoading),
                  hide: source(window.hideLoading),
                  container: source(window.getContainer),
                  overlay: document.getElementById("loading")?.outerHTML.slice(0, 300) ?? "sem #loading",
                };
              }
              if (typeof window.hideLoading !== "function") return { called: false, reason: "hideLoading não é função global" };
              try {
                window.hideLoading();
                return { called: true };
              } catch (error) {
                return { called: true, threw: `${error?.name}: ${error?.message}` };
              }
            },
          });
          sendResponse({ ok: true, result: injection?.result });
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
