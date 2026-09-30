// Carregado antes de content-home.js/content-fisco.js no mesmo mundo isolado —
// funções globais simples, sem módulos ES (mais simples de declarar em manifest.json).

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
  const isHidden = () => {
    const el = document.getElementById("loading");
    return !el || el.classList.contains("hidden");
  };
  await waitFor(isHidden, options);
  // debounce: garante que não é só um instante entre duas chamadas AJAX encadeadas.
  await new Promise((resolve) => setTimeout(resolve, 250));
  await waitFor(isHidden, options);
}

/** Acha o primeiro elemento cujo texto visível bate exatamente (após trim) com `text`, dentro de `root`. */
function findByExactText(selector, text, root = document) {
  const normalized = text.trim();
  return [...root.querySelectorAll(selector)].find((el) => el.textContent.trim() === normalized) ?? null;
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
async function realNavigationClick(el) {
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
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    throw new Error(`REAL_CLICK_ALVO_SEM_TAMANHO: elemento com rect ${JSON.stringify(rect)} — provavelmente invisível ou fora da tela`);
  }
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
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
