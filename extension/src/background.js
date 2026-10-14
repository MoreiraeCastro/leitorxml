// Service worker (MV3, módulo). Único lugar que fala com o backend do
// leitorxml — os content scripts só mexem no DOM do Fisco Fácil e mandam
// mensagens pra cá. Estado da execução em andamento fica em
// chrome.storage.session (sobrevive a navegação de página, não a reinício
// do navegador) sob a chave "activeRun".

const HOME_URL = "https://ssacert.fazenda.rj.gov.br/ssa/certificadoWeb";
const DEFAULT_API_BASE_URL = "https://portalmoreiraecastro.com.br/leitorxml";
// Origens do portal que podem entregar um token à extensão (conexão com um clique).
const PORTAL_ORIGINS = new Set(["https://portalmoreiraecastro.com.br", "http://localhost:3003"]);

// chrome.storage.session só é acessível de contextos confiáveis (páginas da
// extensão/service worker) por padrão — content scripts levam "Access to
// storage is not allowed from this context" até isto ser liberado. Precisa
// rodar toda vez que o service worker acorda (não persiste sozinho).
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => {});

// (Havia aqui um "voltar no histórico com recarga" usado entre procurações. Saiu em 14/10/2026: o ouvinte de
// `pageshow` era posto na página que SAÍA, não na que o Chrome restaurava da memória, então a Página Principal voltava
// do bfcache sem a extensão rodar. Agora tudo vai por `navigateToHome`, que abre a página do zero.)

const COMPANY_PAGE_URL = "https://fisco-facil.fazenda.rj.gov.br/SATI-FiscoFacil/privado/mainAbasContribuinte.xhtml";

/**
 * Depois de baixar um ZIP, volta pro painel da empresa ABRINDO a página direto, sem usar o histórico. A captura do ZIP
 * cancela a requisição do formulário de download (pra o Chrome não salvar uma cópia solta), e isso deixa a aba numa
 * página de erro (ERR_BLOCKED_BY_CLIENT) — "voltar" dali cai na página de erro ou na de detalhe e a corrida perde o fio
 * (visto ao vivo, 2026-10-06). A empresa escolhida fica na sessão do site, então a navegação nova funciona; se o site
 * devolver a lista de empresas, o content script já sabe buscar a empresa de novo.
 */
async function openCompanyPage(tabId) {
  await chrome.tabs.update(tabId, { url: COMPANY_PAGE_URL });
}

/**
 * Clique de verdade via Chrome DevTools Protocol (Input.dispatchMouseEvent),
 * não `dispatchEvent()` — o navegador só conta isso como "ativação de
 * usuário" real quando vem do CDP (ou de um gesto humano de fato). Exige a
 * permissão "debugger" e mostra a barra "está depurando este navegador"
 * enquanto anexado — por isso desanexa (`detach`) logo depois de clicar.
 */
// ---------- Atualização da extensão ----------
// Uma extensão não troca os próprios arquivos: quem troca é o atualizador que o instalador deixou no PC, chamado por
// mensagens nativas (só esta extensão pode chamá-lo). Ele baixa o pacote, confere a assinatura e substitui a pasta; aqui
// a extensão só pergunta a versão ao portal, chama o atualizador e se recarrega — nunca no meio de uma esteira.
const NATIVE_UPDATER = "br.com.moreiraecastro.leitorxml"; // = NATIVE_HOST_NAME em src/lib/leitorxml/instalador.ts
const SELF_UPDATE_ALARM = "self-update";
const SELF_UPDATE_RETRY_MS = 30 * 60 * 1000;
chrome.alarms.get(SELF_UPDATE_ALARM).then((alarm) => {
  if (!alarm) chrome.alarms.create(SELF_UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 30 });
});
chrome.runtime.onStartup.addListener(() => chrome.alarms.create(`${SELF_UPDATE_ALARM}-soon`, { delayInMinutes: 1 }));

// Acabou de se atualizar: o aviso "EXTENSAO_DESATUALIZADA" da consulta anterior ficava vermelho no popup mesmo já na
// versão nova (visto em 14/10/2026, logo após a 1ª atualização automática). Limpa e confere logo o que há para fazer.
chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  if (reason !== "update") return;
  const version = chrome.runtime.getManifest().version;
  trail(`extensão atualizada de ${previousVersion} para ${version}`);
  const { autoTrack } = await chrome.storage.local.get("autoTrack");
  if (autoTrack?.state === "ERRO" && /DESATUALIZADA/.test(autoTrack.message ?? "")) await setAutoStatus({ state: "MANUAL" });
  const { lastSweepError } = await chrome.storage.session.get("lastSweepError");
  if (/DESATUALIZADA/.test(lastSweepError ?? "")) await chrome.storage.session.remove("lastSweepError");
  chrome.alarms.create(AUTO_TRACK_SOON_ALARM, { delayInMinutes: 1 });
});

function isNewerVersion(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

async function latestPublishedVersion() {
  const { apiBaseUrl } = await getSettings();
  const response = await fetch(`${apiBaseUrl}/api/leitorxml/extensao/versao`, { cache: "no-store" });
  if (!response.ok) throw new Error(`VERSAO_INDISPONIVEL_${response.status}`);
  return (await response.json()).version;
}

/** `manual` = botão do popup: tenta mesmo sem versão nova anunciada e informa o erro; automático só age quando é seguro. */
async function selfUpdate({ manual = false } = {}) {
  const current = chrome.runtime.getManifest().version;
  const latest = await latestPublishedVersion().catch(() => null);
  await chrome.storage.local.set({ versionInfo: { current, latest, at: Date.now() } });
  const outdated = Boolean(latest && isNewerVersion(latest, current));
  if (!manual && !outdated) return { ok: true, current, latest };
  if ((await getActiveRun()) || (await getBelt())?.active) {
    return manual ? { ok: false, error: "Tem uma esteira rodando — espere terminar (ou pare) e clique de novo." } : { ok: true, deferred: true };
  }
  const { lastSelfUpdate } = await chrome.storage.local.get("lastSelfUpdate");
  // Evita laço: se já tentou esta versão há pouco e continuou velha (ex.: extensão carregada de outra pasta), espera.
  if (!manual && lastSelfUpdate?.version === latest && Date.now() - lastSelfUpdate.at < SELF_UPDATE_RETRY_MS) return { ok: true, deferred: true };
  await chrome.storage.local.set({ lastSelfUpdate: { version: latest, at: Date.now() } });
  let result;
  try {
    result = await withTimeout(chrome.runtime.sendNativeMessage(NATIVE_UPDATER, { acao: "atualizar" }), "atualizador", 180000);
  } catch (error) {
    // Sempre com o erro original do Chrome: "não instalado" (host not found) e "proibido" (forbidden — esta extensão não
    // está na lista do atualizador) pedem soluções diferentes, e juntar os dois escondeu o diagnóstico em 14/10/2026.
    const message = /not found/i.test(error.message)
      ? `O atualizador não está instalado neste PC: rode o instalador uma vez (portal → Conexões → Extensão). [Chrome: ${error.message}]`
      : /forbidden/i.test(error.message)
        ? `O atualizador deste PC não reconhece esta extensão (id ${chrome.runtime.id}): rode o instalador de novo. [Chrome: ${error.message}]`
        : `O atualizador falhou: ${error.message}`;
    trail(`atualização: ${message}`);
    return { ok: false, error: message };
  }
  if (!result?.ok) {
    trail(`atualização recusada: ${result?.erro ?? "sem resposta"}`);
    return { ok: false, error: `Não atualizou: ${result?.erro ?? "o atualizador não respondeu"}` };
  }
  const onDisk = result.para ?? result.versao;
  if (onDisk && onDisk !== current) {
    trail(`atualização: ${current} → ${onDisk}, recarregando`);
    setTimeout(() => chrome.runtime.reload(), 800); // depois de responder ao popup
    return { ok: true, reloading: true, from: current, to: onDisk };
  }
  return { ok: true, current, latest };
}

// ---------- Rastro da corrida ----------
// Os passos de cada página (note() nos content scripts), as navegações da aba de trabalho e os eventos do background,
// com horário, num só lugar. Vai anexado a toda falha/devolução: sem isso, uma corrida que parava sem registrar nada
// não deixava pista nenhuma (13–14/10/2026).
const TRAIL_MAX = 40;
let trailWrite = Promise.resolve();
function trail(text) {
  const entry = { at: Date.now(), text: String(text).slice(0, 200) };
  trailWrite = trailWrite
    .then(async () => {
      const { runTrail = [] } = await chrome.storage.session.get("runTrail");
      await chrome.storage.session.set({ runTrail: [...runTrail, entry].slice(-TRAIL_MAX) });
    })
    .catch(() => {});
  return trailWrite;
}

/** Rastro desde `since` em texto curto ("hh:mm:ss texto > ..."), pra anexar a uma mensagem de falha. */
async function describeTrail(since = 0, maxChars = 1800) {
  await trailWrite;
  const { runTrail = [] } = await chrome.storage.session.get("runTrail");
  const fmt = (at) => new Date(at).toLocaleTimeString("pt-BR", { hour12: false });
  const text = runTrail.filter((entry) => entry.at >= since - 1000).map((entry) => `${fmt(entry.at)} ${entry.text}`).join(" > ");
  return text.length > maxChars ? `…${text.slice(-maxChars)}` : text;
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!change.status && !change.url) return;
  const url = change.url ?? tab.url ?? "";
  if (!/fazenda\.rj\.gov\.br/.test(url)) return;
  trail(`aba ${tabId}: ${change.status ?? "url"} ${url.replace(/^https:\/\//, "").split("?")[0]}`);
});

/**
 * Nenhuma chamada ao depurador pode ficar pendurada: uma corrida que esperava um clique/digitação real sem resposta
 * ficava muda até o vigia derrubar ("nenhum passo registrado", visto ao vivo várias vezes em 13–14/10/2026). Com
 * limite, vira um erro com nome, reportado na hora.
 */
const DEBUGGER_TIMEOUT_MS = 10000;
function withTimeout(promise, label, ms = DEBUGGER_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`DEPURADOR_SEM_RESPOSTA: ${label} (${ms / 1000}s)`)), ms))),
  ]);
}

/** Anexa o depurador; se uma sessão antiga ficou presa na aba (service worker reiniciado no meio), solta e tenta de novo. */
async function attachDebugger(tabId) {
  try {
    await withTimeout(chrome.debugger.attach({ tabId }, "1.3"), "attach");
  } catch (error) {
    if (!/already attached/i.test(error.message)) throw error;
    trail(`depurador já anexado na aba — soltando a sessão antiga`);
    await withTimeout(chrome.debugger.detach({ tabId }), "detach da sessão antiga").catch(() => {});
    await withTimeout(chrome.debugger.attach({ tabId }, "1.3"), "attach (2ª tentativa)");
  }
}

async function debuggerCommand(tabId, method, params) {
  return withTimeout(chrome.debugger.sendCommand({ tabId }, method, params), method);
}

async function dispatchRealClick(tabId, x, y) {
  await attachDebugger(tabId);
  try {
    await debuggerCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await debuggerCommand(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await debuggerCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  } finally {
    await withTimeout(chrome.debugger.detach({ tabId }), "detach").catch(() => {});
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
  await attachDebugger(tabId);
  try {
    await debuggerCommand(tabId, "Input.insertText", { text });
  } finally {
    await withTimeout(chrome.debugger.detach({ tabId }), "detach").catch(() => {});
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
  return { apiBaseUrl: apiBaseUrl || DEFAULT_API_BASE_URL, apiToken: apiToken || null };
}

async function apiFetch(path, options = {}) {
  const { apiBaseUrl, apiToken } = await getSettings();
  if (!apiToken) throw new Error("SEM_TOKEN_CONFIGURADO");
  const doFetch = () =>
    fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: { ...(options.headers ?? {}), Authorization: `Bearer ${apiToken}`, "X-Leitor-Versao": chrome.runtime.getManifest().version },
    });
  let response = await doFetch();
  // 502/503/504 = portal reiniciando (publicação de versão leva ~10 s): espera e tenta mais uma vez antes de dar erro
  // (visto em 14/10/2026: "API_ERROR_502" vermelho no popup só porque a consulta caiu no meio de um deploy).
  if ([502, 503, 504].includes(response.status) && !(options.body instanceof FormData)) {
    await new Promise((resolve) => setTimeout(resolve, 15000));
    response = await doFetch();
  }
  // O portal recusa trabalho de extensão mais velha que a que ele distribui (ver extension-version.ts no servidor).
  if (response.status === 426) {
    const { esperada } = await response.json().catch(() => ({}));
    chrome.alarms.create(`${SELF_UPDATE_ALARM}-soon`, { delayInMinutes: 0.1 }); // tenta se atualizar já
    throw new Error(`EXTENSAO_DESATUALIZADA: este PC está com a versão ${chrome.runtime.getManifest().version} e o portal pede a ${esperada ?? "mais nova"}. Clique em “Atualizar extensão” (Mais opções).`);
  }
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
const TRACK_IDLE_MS = 3 * 60 * 1000; // ...mas passar 3 min sem NENHUM passo novo é travamento (o teto de 8 min não cobria isso)
chrome.alarms.create("run-watchdog", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SELF_UPDATE_ALARM || alarm.name === `${SELF_UPDATE_ALARM}-soon`) {
    await selfUpdate().catch(() => {});
    return;
  }
  if (alarm.name === AUTO_TRACK_ALARM || alarm.name === AUTO_TRACK_SOON_ALARM) {
    await maybeAutoTrack().catch((error) => setAutoStatus({ state: "ERRO", message: error.message }));
    return;
  }
  if (alarm.name !== "run-watchdog") return;
  const run = await getActiveRun();
  if (!run || run.mode === "SWEEP" || typeof run.startedAt !== "number") return;
  if (run.mode === "TRACK") {
    const { lastNote } = await chrome.storage.session.get("lastNote");
    const idleFor = Date.now() - Math.max(run.startedAt, lastNote?.at ?? 0);
    const totalFor = Date.now() - run.startedAt;
    if (idleFor < TRACK_IDLE_MS && totalFor < (run.verifyOnly ? RUN_STALL_MS : TRACK_STALL_MS)) return;
    await failActiveRun(run, `ACOMPANHAMENTO_TRAVADO em ${run.establishment?.razaoSocial}: ${Math.round(totalFor / 1000)}s no total, ${Math.round(idleFor / 1000)}s sem passo novo; último passo: "${lastNote?.step ?? "nenhum"}" em ${lastNote?.path ?? "?"}`);
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
  // Um passo anterior ao início desta corrida é da corrida passada — citá-lo confunde o diagnóstico (visto ao
  // vivo, 2026-10-13: "último passo: lista vazia" de outra tarefa, quando esta nem chegou a carregar página).
  const onde = lastNote ? `último passo: "${lastNote.step}" em ${lastNote.path}, ${Math.round((Date.now() - lastNote.at) / 1000)}s atrás` : "sem passo registrado";
  // Só é "problema do PC" se a corrida INTEIRA não registrou passo nenhum. `startedAt` é renovado a cada procuração
  // testada na descoberta, então compará-lo com o último passo confundia "travou na 2ª procuração" com "a página nem
  // carregou" e devolvia o pedido sem registrar a falha (14/10/2026).
  if (!lastNote || lastNote.at < (run.claimedAt ?? run.startedAt)) {
    // A corrida não registrou NENHUM passo: a página do Fisco nem carregou a extensão (visto ao vivo, 2026-10-13: 5
    // pedidos seguidos parados em certificadoWeb — sessão caída / Chrome esperando a escolha do certificado). O problema
    // é do PC, não da tarefa: devolve o pedido à fila e para a esteira, em vez de queimar a fila um pedido a cada 4 min.
    await stopBeltPcProblem(run).catch(() => {});
    return;
  }
  await failActiveRun(run, `RUN_TRAVADA: ${Math.round((Date.now() - run.startedAt) / 1000)}s sem terminar nem reportar falha; ${onde}`, await findWorkTabId()).catch(() => {});
});

const PC_PROBLEM_MESSAGE =
  "O Fisco Fácil não carregou nesta aba (a sessão caiu ou o Chrome está esperando você escolher o certificado). Entre no Fisco Fácil com o certificado e clique em “Trabalhar agora” de novo — o pedido voltou para a fila.";

async function stopBeltPcProblem(run) {
  // Todas as abas do Fisco/portal SEFAZ: com mais de uma aberta, a "aba de trabalho" pode não ser a primeira.
  const tabs = await chrome.tabs.query({ url: ["https://fisco-facil.fazenda.rj.gov.br/*", "https://ssacert.fazenda.rj.gov.br/*"] });
  const abas = tabs.map((tab) => `${tab.id}${tab.active ? "*" : ""} ${tab.status} em ${String(tab.url).replace(/^https:\/\//, "").split("?")[0]}`).join(" | ") || "nenhuma";
  const diagnostico = `abas: ${abas}; rastro: ${await describeTrail(run.claimedAt ?? run.startedAt)}`;
  await apiFetch(`/api/leitorxml/extensao/tarefas/${run.taskId}/devolver`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ diagnostico }),
  }).catch(() => {});
  await clearActiveRun();
  await chrome.storage.session.set({ lastSweepError: PC_PROBLEM_MESSAGE });
  const belt = await getBelt();
  if (belt?.active) await endBelt(`Esteira parada: ${PC_PROBLEM_MESSAGE}`);
  await setAutoStatus({ state: "PRECISA_ABRIR_FISCO" });
}

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
  if (belt.auto) {
    const problem = (belt.failed ?? 0) > 0 || /interromp/i.test(summary);
    await setAutoStatus({ state: "CONCLUIDO", message: summary, problem });
    // Com problema: pausa antes de tentar de novo (não martelar o site). Sem problema: reavalia logo (ex.: depois de baixar, pode haver o que solicitar).
    if (problem) await chrome.storage.local.set({ autoPauseUntil: Date.now() + AUTO_PAUSE_AFTER_PROBLEM_MS });
    else chrome.alarms.create(AUTO_TRACK_SOON_ALARM, { delayInMinutes: 1 });
  }
}

// ---------- Entrega dos ZIPs na pasta do SharePoint deste PC ----------
// Depois de baixar do Fisco Fácil e validar no portal, cada ZIP é salvo em Downloads\\Leitor de XML\\<empresa>\\<mês>\\
// por esta extensão. Essa pasta deve ser um ATALHO do Windows (junção) para a pasta sincronizada do SharePoint — o
// OneDrive sobe pra nuvem. Sem credenciais no PC: o arquivo vem por um link temporário (60 s) do portal.
// Só roda se o interruptor "Salvar na pasta" estiver ligado neste computador: sem o atalho, o arquivo cairia numa pasta
// comum e o portal marcaria como entregue sem estar no SharePoint.
let delivering = false;
const DELIVERY_ROOT_FOLDER = "Leitor de XML";

function waitDownload(downloadId, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    const onChanged = (delta) => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === "complete") finish("complete");
      if (delta.state.current === "interrupted") finish("interrupted");
    };
    const finish = (result) => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(result);
    };
    chrome.downloads.onChanged.addListener(onChanged);
  });
}

async function deliverPending() {
  if (delivering) return { delivered: 0, failed: 0, skipped: true };
  const { deliverToFolder = false } = await chrome.storage.local.get("deliverToFolder");
  if (!deliverToFolder) return { delivered: 0, failed: 0, skipped: true };
  delivering = true;
  let delivered = 0;
  let failed = 0;
  try {
    const { items } = await (await apiFetch("/api/leitorxml/extensao/acompanhamento/entregas")).json();
    for (const item of items) {
      try {
        const { url } = await (await apiFetch(`/api/leitorxml/extensao/tarefas/${item.taskId}/arquivo`)).json();
        const downloadId = await chrome.downloads.download({ url, filename: `${DELIVERY_ROOT_FOLDER}/${item.path}`, conflictAction: "overwrite", saveAs: false });
        const outcome = await waitDownload(downloadId);
        if (outcome !== "complete") throw new Error(`download ${outcome}`);
        await apiFetch(`/api/leitorxml/extensao/tarefas/${item.taskId}/entregue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: item.path }),
        });
        await markBaixado(item.taskId);
        chrome.downloads.erase({ id: downloadId }).catch(() => {}); // tira do histórico de transferências (o arquivo fica)
        delivered += 1;
      } catch {
        failed += 1; // tenta de novo na próxima rodada
      }
    }
  } finally {
    delivering = false;
  }
  await chrome.storage.local.set({ lastDelivery: { at: Date.now(), delivered, failed } });
  return { delivered, failed, skipped: false };
}

/** Check "Baixado ✓" no portal: o ZIP está salvo numa pasta deste PC. Só o primeiro PC marca; repetir não muda nada. */
async function markBaixado(taskId) {
  await apiFetch(`/api/leitorxml/extensao/tarefas/${taskId}/baixado`, { method: "POST" }).catch(() => {});
}

// ---------- Cópia na pasta Downloads deste PC ----------
// Todo PC conectado guarda os ZIPs em Downloads\Leitor de XML, mesmo sem OneDrive, e o primeiro que salvar marca o
// check "Baixado ✓" no portal (pedido do João, 13/10/2026: controle de quais empresas já avançaram). A lista inclui os
// já baixados recentemente, pra os dois PCs ficarem com cópia. Se este PC tem o atalho do SharePoint (interruptor
// "deliverToFolder"), a pasta já recebe tudo pela entrega, então esta cópia não é necessária.
let savingCopies = false;

async function saveLocalCopies() {
  if (savingCopies) return { saved: 0, failed: 0, skipped: true };
  const { deliverToFolder = false, localCopiesDone = [], localCopiesSeeded = false } = await chrome.storage.local.get(["deliverToFolder", "localCopiesDone", "localCopiesSeeded"]);
  if (deliverToFolder) return { saved: 0, failed: 0, skipped: true };
  savingCopies = true;
  let saved = 0;
  let failed = 0;
  try {
    const { items } = await (await apiFetch("/api/leitorxml/extensao/acompanhamento/revisao")).json();
    const done = new Set(localCopiesDone);
    // Instalação nova (ou extensão recarregada de outra pasta, que começa sem memória): o que já tem "Baixado ✓" está
    // salvo em algum PC — não baixa tudo de novo (visto em 13/10/2026: uma leva inteira de ZIPs repetidos).
    if (!localCopiesSeeded) {
      for (const item of items) if (item.baixado) done.add(item.taskId);
      await chrome.storage.local.set({ localCopiesSeeded: true });
    }
    // Já salvos neste PC antes do check existir (ou cujo check falhou): marca agora, sem baixar de novo.
    for (const item of items.filter((candidate) => done.has(candidate.taskId) && !candidate.baixado)) await markBaixado(item.taskId);
    for (const item of items.filter((candidate) => !done.has(candidate.taskId)).slice(0, 25)) {
      try {
        const { url } = await (await apiFetch(`/api/leitorxml/extensao/tarefas/${item.taskId}/arquivo`)).json();
        const downloadId = await chrome.downloads.download({ url, filename: `${DELIVERY_ROOT_FOLDER}/${item.path}`, conflictAction: "overwrite", saveAs: false });
        const outcome = await waitDownload(downloadId);
        if (outcome !== "complete") throw new Error(`download ${outcome}`);
        chrome.downloads.erase({ id: downloadId }).catch(() => {});
        if (!item.baixado) await markBaixado(item.taskId);
        done.add(item.taskId);
        saved += 1;
      } catch {
        failed += 1; // tenta de novo na próxima rodada
      }
    }
    const current = new Set(items.map((item) => item.taskId));
    await chrome.storage.local.set({ localCopiesDone: [...done].filter((id) => current.has(id)) });
  } finally {
    savingCopies = false;
  }
  await chrome.storage.local.set({ lastLocalCopies: { at: Date.now(), saved, failed } });
  return { saved, failed, skipped: false };
}

// ---------- Acompanhamento automático ----------
// Pensado pra quem opera sem saber de tecnologia: com o Chrome aberto e o Fisco Fácil logado, a cada ~20 min a
// extensão pergunta ao backend se há algo a baixar/conferir e, havendo, roda sozinha a mesma esteira do botão
// "Conferir resultados e baixar ZIPs". Só LÊ e baixa — nunca cria solicitação nova. Não consegue logar sozinha
// (o acesso é por certificado): sem aba do Fisco Fácil aberta, avisa com um "!" no ícone em vez de tentar.
const AUTO_TRACK_ALARM = "auto-track";
const AUTO_TRACK_SOON_ALARM = "auto-track-soon";
const AUTO_REQUEST_FROM_DAY = 10; // a esteira de solicitações automática só começa a partir do dia 10 (fechamento do mês anterior)
const AUTO_PAUSE_AFTER_PROBLEM_MS = 2 * 60 * 60 * 1000; // esteira automática que terminou com problema não recomeça por 2 h
const AUTO_TRACK_STALE_HOURS = 12; // uma solicitação "aguardando" só é reconferida depois disso (o SEFAZ leva dias)
const AUTO_TRACK_FROM_HOUR = 7; // seg–sex, horário local do PC
const AUTO_TRACK_TO_HOUR = 20;
chrome.alarms.get(AUTO_TRACK_ALARM).then((alarm) => {
  if (!alarm) chrome.alarms.create(AUTO_TRACK_ALARM, { delayInMinutes: 2, periodInMinutes: 20 });
});
// Quando o Chrome abre (PC do escritório ligando), avalia logo em vez de esperar o próximo toque.
chrome.runtime.onStartup.addListener(() => chrome.alarms.create(AUTO_TRACK_SOON_ALARM, { delayInMinutes: 1 }));

async function setAutoStatus(status) {
  await chrome.storage.local.set({ autoTrack: { ...status, at: Date.now() } });
  const needsAttention = status.state === "PRECISA_ABRIR_FISCO" || status.state === "ERRO" || Boolean(status.problem);
  await chrome.action.setBadgeText({ text: needsAttention ? "!" : "" }).catch(() => {});
  if (needsAttention) await chrome.action.setBadgeBackgroundColor({ color: "#c0392b" }).catch(() => {});
}

async function maybeAutoTrack({ ignoreSchedule = false } = {}) {
  await deliverPending().catch(() => {}); // ZIPs que chegaram enquanto este PC estava desligado / fechado
  await saveLocalCopies().catch(() => {});
  const { autoTrackEnabled = true, robotMode = false, autoRequestEnabled = false, autoPauseUntil = 0 } = await chrome.storage.local.get(["autoTrackEnabled", "robotMode", "autoRequestEnabled", "autoPauseUntil"]);
  if (!autoTrackEnabled) return setAutoStatus({ state: "DESLIGADO" });
  const now = new Date();
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  // "Modo PC robô": máquina dedicada, sem ninguém na frente — trabalha a qualquer hora e qualquer dia.
  if (!ignoreSchedule && !robotMode && (weekend || now.getHours() < AUTO_TRACK_FROM_HOUR || now.getHours() >= AUTO_TRACK_TO_HOUR)) return setAutoStatus({ state: "FORA_DO_HORARIO" });
  if (!ignoreSchedule && autoPauseUntil > Date.now()) return; // terminou com problema há pouco: espera, sem martelar o site
  if ((await getActiveRun()) || (await getBelt())?.active) return; // já tem esteira rodando: não interrompe
  const { apiToken } = await getSettings();
  if (!apiToken) return setAutoStatus({ state: "ERRO", message: "Token do backend não configurado na extensão." });
  const summary = await (await apiFetch(`/api/leitorxml/extensao/acompanhamento/resumo?staleHours=${AUTO_TRACK_STALE_HOURS}`)).json();
  // Primeiro baixa/confere o que já foi pedido; só então pede mais (solicitar é opt-in e só a partir do dia 10).
  const trackWork = summary.paraBaixar + summary.aConferir > 0;
  const requestWork = autoRequestEnabled && now.getDate() >= AUTO_REQUEST_FROM_DAY && (summary.agendadas ?? 0) > 0;
  if (!trackWork && !requestWork) return setAutoStatus({ state: "NADA_A_FAZER", summary });
  let tabId = await findWorkTabId();
  if (tabId == null && robotMode) tabId = await openWorkTab();
  if (tabId == null) return setAutoStatus({ state: "PRECISA_ABRIR_FISCO", summary });
  await setAutoStatus({ state: "RODANDO", summary });
  const outcome = trackWork ? await startTrackingBelt({ tabId, auto: true }) : await startRequestBelt({ tabId, auto: true });
  if (!outcome.ok) await setAutoStatus({ state: "ERRO", message: outcome.error });
}

/**
 * O botão único "Trabalhar agora": faz o ciclo inteiro num clique. Primeiro baixa/confere o que já foi pedido e,
 * na sequência, pede as tarefas ainda não pedidas. Pedir cria solicitações REAIS, então o popup pergunta uma vez,
 * ANTES de começar (`decided`/`request`): quem disser não fica só com a conferência.
 */
async function workNow({ tabId, decided = false, request = false }) {
  if ((await getActiveRun()) || (await getBelt())?.active) return { ok: false, error: "JA_TEM_TAREFA_EM_ANDAMENTO" };
  const { apiToken } = await getSettings();
  if (!apiToken) return { ok: false, error: "SEM_TOKEN_CONFIGURADO" };
  const summary = await (await apiFetch(`/api/leitorxml/extensao/acompanhamento/resumo?staleHours=${AUTO_TRACK_STALE_HOURS}`)).json();
  const trackCount = summary.paraBaixar + summary.aConferir;
  const trackWork = trackCount > 0;
  const requestWork = (summary.agendadas ?? 0) > 0;
  if (!trackWork && !requestWork) return { ok: true, nothing: true, summary };
  if (requestWork && !decided) return { ok: true, needsConfirm: { agendadas: summary.agendadas, conferir: trackCount }, summary };
  const thenRequest = requestWork && request;
  if (!trackWork && !thenRequest) return { ok: true, nothing: true, summary };
  // Quem clicou quer trabalhar: sem aba do Fisco Fácil, abre uma (o Chrome mostra a escolha do certificado).
  const workTabId = tabId ?? (await findWorkTabId()) ?? (await openWorkTab());
  const outcome = trackWork ? await startTrackingBelt({ tabId: workTabId, onlyDue: true, thenRequest }) : await startRequestBelt({ tabId: workTabId });
  return { ...outcome, started: trackWork ? "TRACK" : "REQUEST", thenRequest, summary };
}

/**
 * Fim normal da esteira de conferência. Se ela veio do "Trabalhar agora" com pedidos confirmados (`thenRequest`),
 * emenda a esteira de pedidos na mesma aba. Devolve true se emendou (quem chamou não deve mandar a aba pra Home).
 */
async function finishTrackingBelt(summary, tabId) {
  const belt = await getBelt();
  await endBelt(summary);
  if (!belt?.thenRequest || belt.stopRequested) return false;
  await clearActiveRun();
  const outcome = await startRequestBelt({ tabId, trackSummary: summary });
  return Boolean(outcome.ok && outcome.run);
}

/** Guarda o token entregue pelo portal (conexão com um clique). Só aceita de uma página do portal conhecido. */
async function pairFromPortal(message, sender) {
  const senderOrigin = sender.tab?.url ? new URL(sender.tab.url).origin : null;
  if (!senderOrigin || !PORTAL_ORIGINS.has(senderOrigin)) return { ok: false, error: "ORIGEM_NAO_PERMITIDA" };
  if (typeof message.token !== "string" || !message.token.startsWith("lxml_") || typeof message.apiBaseUrl !== "string") return { ok: false, error: "DADOS_INVALIDOS" };
  const apiOrigin = new URL(message.apiBaseUrl).origin;
  if (apiOrigin !== senderOrigin) return { ok: false, error: "ENDERECO_DIFERENTE_DA_ORIGEM" };
  await chrome.storage.local.set({ apiBaseUrl: message.apiBaseUrl.replace(/\/$/, ""), apiToken: message.token });
  await setAutoStatus({ state: "MANUAL" }); // limpa avisos antigos (ex.: "token inválido")
  chrome.alarms.create(AUTO_TRACK_SOON_ALARM, { delayInMinutes: 1 }); // já confere se há algo a baixar
  return { ok: true };
}

/** Modo PC robô: sem nenhuma aba do Fisco Fácil aberta, abre uma (o Chrome escolhe o certificado sozinho por política do Windows). */
async function openWorkTab() {
  // Aba em branco: quem a leva ao portal é a própria esteira (navigateToHome), numa navegação só — navegar duas vezes
  // seguidas reabriria a janela de escolha do certificado.
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  return tab.id ?? null;
}

/** Começa a esteira de solicitações (botão do popup ou automático). */
async function startRequestBelt({ tabId, auto = false, force = false, trackSummary = null }) {
  const existing = await getActiveRun();
  if (existing && !force) return { ok: false, error: "JA_TEM_TAREFA_EM_ANDAMENTO", run: existing };
  await setBelt({ kind: "REQUEST", active: true, auto, processed: 0, failed: 0, failures: 0, stopRequested: false, startedAt: Date.now() });
  if (!trackSummary) await chrome.storage.session.remove("lastSweepError");
  const run = await claimNextTaskAndPrepare(1, null, tabId ?? null);
  if (!run) await endBelt(trackSummary ? `${trackSummary} Nada pendente para pedir.` : "Nada pendente na fila.");
  return { ok: true, run };
}

/** Começa a esteira de acompanhamento (botão do popup ou automático). */
async function startTrackingBelt({ tabId, auto = false, onlyDue = false, thenRequest = false }) {
  const existing = await getActiveRun();
  if (existing) return { ok: false, error: "JA_TEM_TAREFA_EM_ANDAMENTO", run: existing };
  await chrome.storage.session.remove("lastSweepError");
  await setBelt({ kind: "TRACK", active: true, auto, thenRequest, staleHours: auto || onlyDue ? AUTO_TRACK_STALE_HOURS : null, processed: 0, failed: 0, failures: 0, stopRequested: false, startedAt: Date.now() });
  if (!auto) await setAutoStatus({ state: "MANUAL" });
  const first = await claimNextTrackingCompany([], 1, tabId);
  if (!first) {
    const chained = await finishTrackingBelt("Nenhuma solicitação pendente de conferência.", tabId);
    if (chained) return { ok: true, run: await getActiveRun() };
  }
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
/** Espera a aba começar a sair de onde está (URL nova ou carregando). Devolve false se ela ficou parada. */
async function waitForTabToNavigate(tabId, fromUrl, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return false;
    if (tab.status === "loading" || (tab.pendingUrl && tab.pendingUrl !== fromUrl) || (tab.url && tab.url !== fromUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function navigateToHome(preferredTabId) {
  if (preferredTabId != null) {
    const before = await chrome.tabs.get(preferredTabId).catch(() => null);
    trail(`indo para a Página Principal pela aba ${preferredTabId} (estava em ${String(before?.url ?? "?").replace(/^https:\/\//, "").split("?")[0]})`);
    await chrome.tabs.update(preferredTabId, { active: true, url: HOME_URL });
    // Em 14/10/2026 a aba ficou parada na lista de empresas depois deste comando (nenhuma navegação registrada) e a
    // corrida morreu muda. Se a aba não se mexer, abre a Página Principal numa aba nova e segue por ela.
    if (before?.url && before.url !== HOME_URL && !(await waitForTabToNavigate(preferredTabId, before.url))) {
      trail(`a aba ${preferredTabId} não saiu da página — abrindo a Página Principal numa aba nova`);
      const fresh = await chrome.tabs.create({ url: HOME_URL, active: true });
      trail(`aba nova ${fresh.id} aberta`);
    }
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
    // O vigia renova `startedAt` a cada passo da descoberta; o rastro anexado às falhas parte daqui (início do pedido).
    claimedAt: Date.now(),
    chainCount,
  };
  await setActiveRun(run);
  trail(`nova corrida: ${task.tipoDocumento}/${task.papel} de ${establishment.cnpj} (procuração ${accessContext?.grupo ?? "?"}/${accessContext?.posicao ?? "a descobrir"}, ${run.step})`);
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
    if (!next) await finishTrackingBelt(`Conferência concluída: ${belt.processed} empresa(s) conferida(s), ${failed} falha(s).`, tabId);
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
  trail(`falha: ${motivo.slice(0, 120)}`);
  await reportFalha(run.taskId, `${motivo.slice(0, 2000)} [Rastro: ${await describeTrail(run.claimedAt ?? run.startedAt)}]`);
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
      // 204 (sem conteúdo): pro navegador é "não há nada pra mostrar", então a página continua onde está — sem salvar
      // uma cópia solta do ZIP e SEM a tela de erro. O antigo failRequest("BlockedByClient") trocava a página por
      // ERR_BLOCKED_BY_CLIENT, e com a página trocada o script da extensão morria no meio do fluxo (visto ao vivo, 2026-10-06).
      await chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 204, responseHeaders: [] }).catch(() => {});
      // O Chrome já tinha registrado o clique como um download e o marca como "arquivo não estava disponível": sem nenhum
      // arquivo salvo, mas fica uma linha de erro no histórico de transferências. Apaga essas linhas (só as interrompidas
      // do resultadoExtracaoDfe) pra ninguém achar que deu erro.
      setTimeout(() => chrome.downloads.erase({ urlRegex: "resultadoExtracaoDfe", state: "interrupted" }).catch(() => {}), 2500);
    }
  };

  await attachDebugger(tabId);
  chrome.debugger.onEvent.addListener(onEvent);
  try {
    await debuggerCommand(tabId, "Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Response" }] });
    await debuggerCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await debuggerCommand(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await debuggerCommand(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "DOWNLOAD_NAO_CAPTURADO_EM_60S" }), 60000));
    const result = await Promise.race([finished, timeout]);
    if (!result.ok && result.error?.startsWith("DOWNLOAD_NAO_CAPTURADO")) {
      const [latest] = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 });
      result.diag = `respostas vistas: [${seen.join(" | ")}]; último download do Chrome: ${latest ? `${latest.mime} ${String(latest.filename).split(/[\\/]/).pop()} ${latest.state}` : "nenhum"}`;
    }
    return result;
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    await debuggerCommand(tabId, "Fetch.disable").catch(() => {});
    await withTimeout(chrome.debugger.detach({ tabId }), "detach").catch(() => {});
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
          sendResponse(await startRequestBelt({ force: Boolean(message.force) }));
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
        case "DISCOVERY_FALLBACK": {
          // A empresa não estava na procuração do índice: recomeça pela Página Principal em modo descoberta,
          // em todos os grupos, pulando a procuração que já falhou. Só uma vez por corrida.
          const run = await getActiveRun();
          if (!run || run.discovery || run.discoveryFallbackFrom || run.accessContext?.type !== "PROCURACAO" || run.accessContext.posicao == null) {
            return sendResponse({ ok: false });
          }
          const from = { grupo: run.accessContext.grupo, posicao: run.accessContext.posicao };
          await setActiveRun({
            ...run,
            step: "NAVIGATE_HOME",
            accessContext: { type: "PROCURACAO", grupo: null, posicao: null },
            discoveryExclude: [from],
            discoveryFallbackFrom: from,
            listaContribuintesAttempts: 0,
            startedAt: Date.now(),
          });
          await navigateToHome(sender.tab?.id ?? null);
          sendResponse({ ok: true });
          break;
        }
        case "DISCOVERY_NOT_FOUND": {
          // Não é essa posição — avança o cursor e volta pro histórico pra content-home.js testar a próxima.
          const run = await getActiveRun();
          if (!run?.discovery) return sendResponse({ ok: false, error: "NO_DISCOVERY_IN_PROGRESS" });
          const nextCursor = run.discovery.cursor + 1;
          if (nextCursor >= run.discovery.queue.length) {
            const from = run.discoveryFallbackFrom;
            const motivo = from
              ? `EMPRESA_FORA_DAS_PROCURACOES: CNPJ ${run.establishment.cnpj} não está mais na procuração ${from.grupo ?? "?"}/${from.posicao} (onde o índice dizia) nem em nenhuma das outras ${run.discovery.queue.length} procurações — conferir no Fisco Fácil se a procuração dessa empresa ainda está ativa.`
              : `CNPJ ${run.establishment.cnpj} não encontrado em nenhuma das ${run.discovery.queue.length} procurações testadas.`;
            await failActiveRun(run, motivo, sender.tab?.id);
            sendResponse({ ok: true, done: true });
            break;
          }
          // Cada procuração testada é progresso: renova o relógio do vigia (a fila inteira passa fácil de 3 min)
          // e zera o contador de segurança da lista de empresas (que conta visitas, não falhas).
          await setActiveRun({ ...run, discovery: { ...run.discovery, cursor: nextCursor }, startedAt: Date.now(), listaContribuintesAttempts: 0 });
          // Página Principal aberta do zero, NUNCA pelo "voltar": o Chrome restaurava a página da memória (bfcache), a
          // extensão não rodava nela e a descoberta parava na 2ª procuração (registro de 14/10/2026, 13h12).
          const [tab] = sender.tab ? [sender.tab] : await chrome.tabs.query({ url: "https://fisco-facil.fazenda.rj.gov.br/*", active: true });
          if (tab) await navigateToHome(tab.id);
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
          await setActiveRun({ ...run, sweepCursor: nextCursor, sweepRetries: 0 });
          // Mesmo motivo da descoberta: Página Principal do zero, não pelo "voltar" (bfcache).
          const [tab] = sender.tab ? [sender.tab] : await chrome.tabs.query({ url: "https://fisco-facil.fazenda.rj.gov.br/*", active: true });
          if (tab) await navigateToHome(tab.id);
          sendResponse({ ok: true });
          break;
        }
        case "SWEEP_RETRY_POSITION": {
          // A lista lida era a da procuração anterior (tela velha) — reabre a MESMA posição pela Página Principal.
          const run = await getActiveRun();
          if (!run) return sendResponse({ ok: false, error: "NO_ACTIVE_RUN" });
          await setActiveRun({ ...run, sweepRetries: (run.sweepRetries ?? 0) + 1 });
          const [tab] = sender.tab ? [sender.tab] : await chrome.tabs.query({ url: "https://fisco-facil.fazenda.rj.gov.br/*", active: true });
          if (tab) await navigateToHome(tab.id);
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
        case "SAVE_LOCAL_COPIES": {
          sendResponse(await saveLocalCopies());
          break;
        }
        case "START_TRACKING": {
          sendResponse(await startTrackingBelt({ tabId: sender.tab?.id }));
          break;
        }
        case "WORK_NOW": {
          sendResponse(await workNow({ tabId: sender.tab?.id, decided: Boolean(message.decided), request: Boolean(message.request) }));
          break;
        }
        case "PAIR_FROM_PORTAL": {
          sendResponse(await pairFromPortal(message, sender));
          break;
        }
        case "PAIRING_STATUS": {
          sendResponse({ ok: true, paired: Boolean((await getSettings()).apiToken) });
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
            const chained = await finishTrackingBelt(`Conferência concluída: ${processed} empresa(s) conferida(s), ${belt?.failed ?? 0} falha(s).`, sender.tab?.id);
            if (!chained) await finishBatchAndReturnHome(sender.tab?.id);
          }
          sendResponse({ ok: true, done: !run, run });
          break;
        }
        case "TRACK_GO_BACK": {
          // Da página de detalhe da solicitação de volta pro painel da empresa (com reload de verdade, sem bfcache).
          if (sender.tab) await openCompanyPage(sender.tab.id);
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
          const captured = await captureDownloadViaCdp(sender.tab.id, message.x, message.y, message.taskId);
          sendResponse({ ok: true, result: captured });
          if (captured.ok) { deliverPending().catch(() => {}); saveLocalCopies().catch(() => {}); } // já salva o recém-baixado na pasta, sem esperar a próxima rodada
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
        case "UPDATE_EXTENSION": {
          sendResponse(await selfUpdate({ manual: true }));
          break;
        }
        case "TRAIL": {
          await trail(`${message.path ?? ""}: ${message.text}`);
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
