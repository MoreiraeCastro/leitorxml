// Carregado antes de content-home.js/content-fisco.js no mesmo mundo isolado —
// funções globais simples, sem módulos ES (mais simples de declarar em manifest.json).

/**
 * Captura erros JS não tratados da página (ex.: o "ReferenceError: options is
 * not defined" do próprio Fisco Fácil, achado ao vivo em 2026-09-30 só porque
 * o usuário checou o DevTools manualmente). O evento "error" do window chega
 * no mundo isolado do content script mesmo quando a exceção acontece no mundo
 * principal — os dois compartilham o mesmo objeto window pra despacho de
 * eventos, só não compartilham variáveis/funções JS. Guardando isso aqui, dá
 * pra anexar automaticamente na mensagem de falha reportada ao backend, sem
 * precisar perguntar pro usuário o que apareceu no console a cada teste.
 */
const pageErrorLog = [];
window.addEventListener("error", (event) => {
  pageErrorLog.push(`${event.message} (${event.filename?.split("/").pop()}:${event.lineno})`);
  if (pageErrorLog.length > 10) pageErrorLog.shift();
});

/** Rastro de passos da execução atual (ex.: "digitou CNPJ", "clicou Filtrar") — anexado em falhas pra dar contexto sem precisar perguntar o que apareceu na tela. */
const executionTrail = [];
function note(step) {
  executionTrail.push(step);
  if (executionTrail.length > 20) executionTrail.shift();
}

/** Monta o texto de diagnóstico (rastro de passos + erros JS da página) pra anexar numa mensagem de falha. */
function describeDiagnostics() {
  const parts = [];
  if (executionTrail.length) parts.push(`Passos: ${executionTrail.join(" > ")}`);
  if (pageErrorLog.length) parts.push(`Erros JS da página: ${pageErrorLog.join(" ;; ")}`);
  return parts.length ? ` [${parts.join(" | ")}]` : "";
}

/** Zera o registro de XHRs do site (gravado por `ensurePageGlobals` em background.js) — chamar antes de uma ação pra ver só as requisições dela. */
function clearXhrLog() {
  delete document.documentElement.dataset.leitorxmlXhr;
  delete document.documentElement.dataset.leitorxmlEvents;
}

/** Resume as XHRs registradas desde o último `clearXhrLog()`: alvo, parâmetros enviados, status e componentes atualizados. */
function describeXhrLog() {
  let log = [];
  try {
    log = JSON.parse(document.documentElement.dataset.leitorxmlXhr || "[]");
  } catch {}
  let events = [];
  try {
    events = JSON.parse(document.documentElement.dataset.leitorxmlEvents || "[]");
  } catch {}
  let pageErrors = [];
  try {
    pageErrors = JSON.parse(document.documentElement.dataset.leitorxmlErrors || "[]");
  } catch {}
  const errorsText = pageErrors.length ? `; erros no mundo principal: ${pageErrors.join(" ;; ")}` : "";
  const eventsText =
    (events.length
      ? `eventos recebidos pela página: ${events.map((e) => `${e.type}@${e.tag}${e.id ? `#${e.id}` : ""}${e.trusted ? "" : "(sintético)"}`).join(", ")}`
      : "página não recebeu nenhum mousedown/click/submit") + errorsText;
  if (!log.length) return `nenhuma requisição AJAX disparada; ${eventsText}`;
  return `${log.map((entry) => `${entry.method} ${entry.url} ${JSON.stringify(entry.params)} -> ${entry.status}${entry.updates?.length ? ` atualizou [${entry.updates.join(",")}]` : ""}`).join(" ; ")}; ${eventsText}`;
}

/** Quantas XHRs o site disparou desde o último `clearXhrLog()`. */
function xhrCount() {
  try {
    return JSON.parse(document.documentElement.dataset.leitorxmlXhr || "[]").length;
  } catch {
    return 0;
  }
}

/** Observa o overlay #loading: `stop()` devolve true se ele chegou a aparecer (prova de que o clique disparou algo). */
function watchLoadingOverlay() {
  let seen = false;
  // O site cria um CLONE do template #loading (mesmo id) ao mostrar o overlay — por isso observa a
  // árvore inteira (childList + class/style), não só o elemento original.
  const observer = new MutationObserver(() => {
    if (isLoadingOverlayVisible()) seen = true;
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  return {
    stop() {
      observer.disconnect();
      return seen;
    },
  };
}

// Nenhuma etapa do fluxo por tarefa (entrar em procuração, buscar empresa,
// preencher/confirmar formulário) deveria legitimamente passar disso — só
// cobre o modo por-tarefa (REQUEST_NEXT_TASK), não a varredura completa
// (SWEEP), que naturalmente demora mais e já tem seu próprio avanço de fila.
const MAX_TASK_RUN_DURATION_MS = 5 * 60 * 1000;

/**
 * Detecta corrida travada silenciosamente: se a página recarrega no meio de
 * uma espera (`waitFor`), a promise pendente some junto com o contexto
 * antigo — nem sucesso nem falha é reportado, e a tarefa fica presa em
 * AUTENTICANDO pra sempre (visto ao vivo várias vezes, 2026-09-30, com
 * `erro_mensagem: null` indefinidamente). Cada content script confere isso
 * ao carregar e falha alto em vez de ficar preso até alguém notar e resetar
 * manualmente no banco.
 */
function runExpired(run) {
  return run?.mode !== "SWEEP" && typeof run?.startedAt === "number" && Date.now() - run.startedAt > MAX_TASK_RUN_DURATION_MS;
}

/**
 * Espera até `check()` retornar algo truthy, ou estoura timeout. Faz polling
 * em vez de depender de eventos do jQuery/PrimeFaces, que não são visíveis do
 * mundo isolado da extensão. `label` identifica a espera na mensagem de erro
 * (ex.: "modal Escolha um perfil abrir") — sem isso, todo timeout vira o mesmo
 * "TIMEOUT_WAITING_FOR_CONDITION" genérico e não dá pra saber qual etapa travou.
 */
function waitFor(check, { timeoutMs = 15000, intervalMs = 150, label = "condição" } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const value = check();
      if (value) return resolve(value);
      if (Date.now() - start > timeoutMs) return reject(new Error(`TIMEOUT: ${label} (${timeoutMs}ms) em ${location.pathname}`));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/**
 * Espera o indicador de carregamento do PrimeFaces (#loading, classe "hidden"
 * alternada por showLoading/hideLoading) ficar estável em "escondido" — é como
 * o site sinaliza fim de requisição AJAX, sem precisar ganchar em jQuery.
 */
async function waitForAjaxIdle(options = {}) {
  // Só o #loading escondido não basta: o overlay pode ainda não ter aparecido (ou já
  // ter sumido) enquanto a XHR segue pendente — visto ao vivo, 2026-10-02: a busca foi
  // dada como terminada com a requisição do Filtrar `pendente`, e a tabela foi lida
  // antes da resposta (sempre a lista inteira). Também espera as XHRs registradas por
  // `ensurePageGlobals` (background.js) terminarem.
  const waitOptions = { timeoutMs: 30000, ...options };
  await waitFor(() => !hasPendingXhr(), waitOptions);
  // O overlay deveria sumir sozinho assim que as XHRs terminam; se não sumir em 3s, está preso
  // (o clone criado por showLoading nunca é removido — visto ao vivo, 2026-10-02).
  try {
    await waitFor(() => !isLoadingOverlayVisible(), { timeoutMs: 3000, label: "overlay #loading sumir" });
  } catch {
    await unstickLoadingOverlay();
  }
  // debounce: garante que não é só um instante entre duas chamadas AJAX encadeadas.
  await new Promise((resolve) => setTimeout(resolve, 250));
  await waitFor(() => !hasPendingXhr(), waitOptions);
  if (isLoadingOverlayVisible()) await unstickLoadingOverlay();
}

/**
 * O overlay #loading cobre a tela inteira enquanto visível e engole o clique.
 * Visto ao vivo (2026-10-02): ficou preso visível depois do AJAX do Filtrar já
 * ter terminado. Espera sumir; se estiver preso (sem XHR pendente), chama o
 * hideLoading() do próprio site; se mesmo assim não sumir, falha com o código
 * das funções do site pra diagnóstico.
 */
async function clearLoadingOverlayCovering() {
  if (!isLoadingOverlayVisible()) return;
  try {
    await waitFor(() => !isLoadingOverlayVisible(), { timeoutMs: 6000, label: "overlay #loading sumir antes do clique" });
    return;
  } catch {}
  await waitFor(() => !hasPendingXhr(), { timeoutMs: 20000, label: "XHR pendente terminar antes do clique" }).catch(() => {});
  if (isLoadingOverlayVisible()) await unstickLoadingOverlay();
}

/**
 * Overlay preso visível: chama o hideLoading() do próprio site e, se algum clone
 * continuar visível, esconde à força. O site cria um clone do template #loading (mesmo
 * id, dois elementos) ao mostrar e deveria removê-lo ao terminar — visto ao vivo
 * (2026-10-02) o clone ficou cobrindo a tela depois do AJAX terminar.
 */
async function unstickLoadingOverlay() {
  const hidden = await chrome.runtime.sendMessage({ type: "HIDE_LOADING" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (!isLoadingOverlayVisible()) {
    note(`overlay #loading preso: resolvido por hideLoading() (${JSON.stringify(hidden?.result)})`);
    return;
  }
  for (const el of document.querySelectorAll('[id="loading"]')) {
    if (isElementVisible(el)) el.style.display = "none";
  }
  note(`overlay #loading preso: hideLoading()=${JSON.stringify(hidden?.result)} não bastou, escondi à força [${describeLoadingOverlay()}]`);
}

/**
 * Visibilidade REAL do overlay #loading (estilo computado), não a classe "hidden":
 * ao vivo (2026-10-02) o overlay estava visível e cobrindo a tela enquanto a checagem
 * por classe dizia "escondido" — por isso "loading apareceu: não" em todos os testes e
 * o waitForAjaxIdle nunca esperava de verdade.
 */
function isElementVisible(el) {
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && el.offsetWidth > 0 && el.offsetHeight > 0;
}

// `[id="loading"]` pega TODOS os elementos com esse id (há mais de um: template escondido + clone visível) — getElementById só devolveria o primeiro.
function isLoadingOverlayVisible() {
  return [...document.querySelectorAll('[id="loading"]')].some(isElementVisible);
}

/** Descrição curta de cada elemento #loading (classe, display, tamanho) pra diagnóstico. */
function describeLoadingOverlay() {
  const all = [...document.querySelectorAll('[id="loading"]')];
  if (!all.length) return "sem #loading";
  return all
    .map((el) => {
      const style = getComputedStyle(el);
      return `{class="${el.className}" display=${style.display} ${el.offsetWidth}x${el.offsetHeight}}`;
    })
    .join(" ");
}

/** Verdadeiro se alguma XHR do site registrada (ver `ensurePageGlobals`) ainda não terminou. */
function hasPendingXhr() {
  try {
    return JSON.parse(document.documentElement.dataset.leitorxmlXhr || "[]").some((entry) => entry.status === "pendente");
  } catch {
    return false;
  }
}

/** Acha o primeiro elemento cujo texto visível bate exatamente (após trim) com `text`, dentro de `root`. */
function findByExactText(selector, text, root = document) {
  const normalized = text.trim();
  return [...root.querySelectorAll(selector)].find((el) => el.textContent.trim() === normalized) ?? null;
}

/**
 * Elemento visível mais interno cujo texto (ou value, em input de botão) é exatamente `text` —
 * qualquer tipo de elemento clicável (button, a, input, span, div...), não só <button>/<a>: o
 * "Fechar" dos modais do Fisco Fácil não foi achado por `button, a` ao vivo (2026-10-02).
 */
function findVisibleClickableByText(text) {
  const normalized = text.trim();
  const matches = [...document.querySelectorAll("button, a, input, span, div, label")].filter((el) => {
    const content = el.tagName === "INPUT" ? el.value : el.textContent;
    return content?.trim() === normalized && el.offsetWidth > 0 && el.offsetHeight > 0;
  });
  return matches.find((el) => !matches.some((other) => other !== el && el.contains(other))) ?? null;
}

/** Acha todos os elementos cujo texto visível contém `text` (case-insensitive), dentro de `root`. */
function findAllByText(selector, text, root = document) {
  const normalized = text.trim().toLowerCase();
  return [...root.querySelectorAll(selector)].filter((el) => el.textContent.trim().toLowerCase().includes(normalized));
}

/**
 * Dispara um clique real (mousedown+mouseup+click) — mais fiel do que só
 * .click() para widgets PrimeFaces que ouvem mousedown. Botões PrimeFaces são
 * quase todos type="submit" contando com o próprio handler onclick pra
 * interceptar via AJAX (PrimeFaces.ab/.bcn) — se o clique sintético não
 * disparar isso do jeito esperado, o navegador cai no submit nativo do form
 * e recarrega a página inteira (visto ao vivo: reload completo repetido).
 * Blindagem: nunca deixa um form submeter de verdade a partir de um clique nosso.
 */
function realClick(el) {
  el.scrollIntoView({ block: "center" });
  const form = el.closest("form");
  if (form) form.addEventListener("submit", (event) => event.preventDefault(), { capture: true, once: true });
  for (const type of ["mousedown", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
}

/**
 * Clique de verdade (via chrome.debugger/CDP, mensagem REAL_CLICK ao
 * background), não `dispatchEvent()`. Confirmado ao vivo (2026-09-30) que o
 * Fisco Fácil precisa disso pra praticamente qualquer interação que dispare
 * AJAX/navegação no servidor — clique sintético falha silenciosamente (sem
 * erro, sem efeito) de forma inconsistente: às vezes na 1ª tentativa funciona,
 * na 2ª em diante não. Usada em todo clique de `content-fisco.js`, exceto o
 * card "AUTO Fisco Fácil" em `content-home.js` (esse, `realClick()` normal
 * sempre funcionou em todos os testes).
 */
/**
 * Rádio/checkbox do PrimeFaces: o <input> real fica escondido (ui-helper-hidden-accessible)
 * e o que aparece e recebe o clique é uma caixa desenhada por cima
 * (`.ui-radiobutton-box` / `.ui-chkbox-box`) — clicar nas coordenadas do input cai na caixa
 * (visto ao vivo, 2026-10-02: REAL_CLICK_ALVO_COBERTO no rádio "Meses"). Devolve o alvo visível.
 */
function visibleClickTarget(el) {
  if (!(el instanceof HTMLInputElement) || !["radio", "checkbox"].includes(el.type)) return el;
  // Alvo = o que está de fato por cima do centro do input (ele mesmo, ou a caixa desenhada
  // pelo PrimeFaces). Escolher a caixa "por classe" falhou ao vivo (2026-10-02): nos rádios de
  // tipo de documento o input é visível e a caixa achada tinha tamanho zero.
  el.scrollIntoView({ block: "center", behavior: "instant" });
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const group = el.closest(".ui-radiobutton, .ui-chkbox, label, td");
    if (top && (top === el || group?.contains(top))) return top;
  }
  const box = el.closest(".ui-radiobutton, .ui-chkbox")?.querySelector(".ui-radiobutton-box, .ui-chkbox-box");
  if (box && box.offsetWidth > 0) return box;
  const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  return label && label.offsetWidth > 0 ? label : el;
}

async function realNavigationClick(el) {
  el = visibleClickTarget(el);
  // Mesma blindagem de `realClick()`: se o clique não disparar o handler
  // AJAX esperado do jeito certo, o navegador pode cair no submit nativo do
  // form (POST/GET pra mesma URL) em vez da navegação real esperada — visto
  // ao vivo em 2026-09-30 na lista de empresas: a página recarregava e
  // voltava pra lista repetidamente (6x, até o guard de segurança travar),
  // sem nenhum erro, sem nunca chegar a `mainAbasContribuinte`. Clique real
  // (CDP) conta como gesto de usuário de verdade e ativa esse fallback nativo
  // de um jeito que o clique sintético de antes não ativava.
  const form = el.closest("form");
  if (form) form.addEventListener("submit", (event) => event.preventDefault(), { capture: true, once: true });
  // behavior:"instant" evita rolagem suave — se a página tiver scroll-behavior:
  // smooth (comum em CSS moderno) e a gente medir a posição antes da rolagem
  // terminar, o clique via CDP acerta coordenadas erradas sem erro nenhum.
  el.scrollIntoView({ block: "center", behavior: "instant" });
  await new Promise((resolve) => setTimeout(resolve, 300)); // deixa o layout assentar antes de medir a posição na tela
  await clearLoadingOverlayCovering();
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    throw new Error(`REAL_CLICK_ALVO_SEM_TAMANHO: ${el.tagName}#${el.id}.${String(el.className).slice(0, 60)} com rect ${JSON.stringify(rect)} — provavelmente invisível ou fora da tela`);
  }
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
  // Confere que o elemento no ponto é o alvo (ou algo dentro dele): se outro
  // elemento cobrir o ponto, ou o ponto cair fora da janela, o CDP "clica com
  // sucesso" em outra coisa e nada acontece — nunca clicar às cegas.
  const topmost = document.elementFromPoint(x, y);
  if (!topmost || !(el === topmost || el.contains(topmost))) {
    const describe = (node) => (node ? `${node.tagName}${node.id ? `#${node.id}` : ""}.${String(node.className ?? "").slice(0, 40)}` : "nada (fora da janela)");
    throw new Error(`REAL_CLICK_ALVO_COBERTO: em (${x},${y}) está ${describe(topmost)}, esperava ${describe(el)} [janela ${window.innerWidth}x${window.innerHeight}] [overlay: ${describeLoadingOverlay()}]`);
  }
  const response = await chrome.runtime.sendMessage({ type: "REAL_CLICK", x, y });
  if (!response?.ok) throw new Error(response?.error ?? "REAL_CLICK_FALHOU");
}

/** Define o valor de um input controlado (React/PrimeFaces-friendly): seta via setter nativo e dispara input+change. */
function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Digitação real (via chrome.debugger/CDP, mensagem REAL_TYPE) num campo
 * "InputMask" (ex.: busca por CNPJ do Fisco Fácil, jquery.inputmask) — essas
 * libs reimplementam a inserção de texto via JS, sem confiar na inserção
 * nativa do navegador. Nem setar `.value` direto (`setInputValue`) nem
 * disparar `KeyboardEvent` sintético funcionam: o primeiro faz a lib mandar
 * um valor errado/truncado pro servidor, o segundo é simplesmente ignorado
 * (campo fica vazio) — ambos confirmados ao vivo, 2026-09-30. `Input.insertText`
 * via CDP passa pela inserção nativa de texto de verdade.
 */
async function typeIntoMaskedInput(input, text) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  const digitsInField = () => (input.value || "").replace(/\D/g, "");
  const expectedDigits = text.replace(/\D/g, "");
  // Igual ao clique via CDP: o REAL_TYPE pode responder ok:true sem ter
  // efeito nenhum no campo (visto ao vivo, 2026-09-30 — o campo ficou vazio
  // mesmo com a mensagem retornando sucesso). Nunca confia cegamente: confere
  // se o valor realmente entrou, e tenta de novo (1x) antes de falhar alto —
  // continuar com o campo vazio faz a busca cair na 1ª linha sem filtro.
  for (let attempt = 1; attempt <= 2; attempt++) {
    input.focus();
    setter.call(input, ""); // limpa antes (importante numa 2ª tentativa, com conteúdo antigo no campo)
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const response = await chrome.runtime.sendMessage({ type: "REAL_TYPE", text });
    if (!response?.ok) throw new Error(response?.error ?? "REAL_TYPE_FALHOU");
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (digitsInField() === expectedDigits) return;
  }
  throw new Error(`REAL_TYPE_NAO_REFLETIU_NO_CAMPO: campo continua com "${input.value}" após 2 tentativas (esperava ${expectedDigits})`);
}

/**
 * "Certificado conectado / empresa selecionada" — atualizado por todo content
 * script sempre que carrega, independente de haver uma tarefa em andamento.
 * O popup lê isto pra mostrar o status sem precisar abrir o Fisco Fácil pra ver.
 */
async function setConnectionStatus(patch) {
  const { connectionStatus } = await chrome.storage.session.get("connectionStatus");
  await chrome.storage.session.set({ connectionStatus: { ...connectionStatus, ...patch, updatedAt: Date.now() } });
}
