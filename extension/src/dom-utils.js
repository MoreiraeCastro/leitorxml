// Carregado antes de content-home.js/content-fisco.js no mesmo mundo isolado —
// funções globais simples, sem módulos ES (mais simples de declarar em manifest.json).

/** Espera até `check()` retornar algo truthy, ou estoura timeout. Faz polling em vez de depender de eventos do jQuery/PrimeFaces, que não são visíveis do mundo isolado da extensão. */
function waitFor(check, { timeoutMs = 15000, intervalMs = 150 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const value = check();
      if (value) return resolve(value);
      if (Date.now() - start > timeoutMs) return reject(new Error("TIMEOUT_WAITING_FOR_CONDITION"));
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

/** Dispara um clique real (mousedown+mouseup+click) — mais fiel do que só .click() para widgets PrimeFaces que ouvem mousedown. */
function realClick(el) {
  el.scrollIntoView({ block: "center" });
  for (const type of ["mousedown", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
}

/** Define o valor de um input controlado (React/PrimeFaces-friendly): seta via setter nativo e dispara input+change. */
function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
