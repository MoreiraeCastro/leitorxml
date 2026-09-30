// Roda em ssacert.fazenda.rj.gov.br (portal SEFAZ, seleção de certificado/procuração).
// Só entra em ação quando existe uma "activeRun" pendente pedindo pra chegar
// numa procuração específica.

async function getActiveRun() {
  const response = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_RUN" });
  return response?.run ?? null;
}

/**
 * Nome completo do titular do certificado, do painel "Minha conta"
 * (h6.text-body dentro de .area-user-login — confirmado via HTML real).
 * O painel é hidratado por um componente Angular depois do carregamento
 * inicial da página, então precisa esperar em vez de ler uma vez só.
 */
async function readCertificateHolderNameOnHome() {
  const el = await waitFor(
    () => [...document.querySelectorAll("h6")].find((h) => h.className.includes("text-body")) ?? null,
    { timeoutMs: 5000, label: "painel Minha conta (nome do certificado)" },
  ).catch(() => null);
  return el?.textContent.trim() ?? null;
}

function findAutoFiscoFacilCard() {
  const heading = findByExactText("h5", "AUTO Fisco Fácil");
  return heading?.closest("a.card") ?? null;
}

const CHAMA_APLICACAO_RE =
  /chamaAplicacao\(\s*'([^']*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']*)'\s*,\s*(\d+)\s*,\s*(true|false)\s*\)/;

/**
 * Varre #conteudoModalAutorizacoes por grupo (`h6.fw-bold`, ex.: "SUBFIN") e
 * link de acesso (`span[onclick*="chamaAplicacao"]`) — confirmado via HTML
 * real capturado ao vivo em 2026-09-30. Usa o `perfil` (2º argumento
 * numérico de `chamaAplicacao(url, sistema, perfil, orgao, classe, ds,
 * origem, fullScreen)`) como identificador de posição — é o ID real e
 * estável que o servidor usa, não uma contagem de ordem no DOM (frágil,
 * usada antes; abandonada por causar entradas inconsistentes entre
 * reaberturas do modal).
 */
function collectProcuracaoLinks(container) {
  const items = [];
  let currentGroup = null;
  for (const el of container.querySelectorAll("h6.fw-bold, span[onclick*='chamaAplicacao']")) {
    if (el.matches("h6.fw-bold")) {
      currentGroup = el.textContent.trim();
      continue;
    }
    const match = CHAMA_APLICACAO_RE.exec(el.getAttribute("onclick") ?? "");
    if (!match) continue;
    const [, url, sistema, perfil, orgao, classe, ds, origem] = match;
    items.push({ grupo: currentGroup, posicao: Number(perfil), args: { url, sistema, perfil, orgao, classe, ds, origem } });
  }
  return items;
}

/** Abre o modal "Escolha um perfil" e devolve o container com os links já carregados (AJAX). */
async function openAutoFiscoFacilModal() {
  const card = await waitFor(findAutoFiscoFacilCard, { timeoutMs: 10000, label: "card AUTO Fisco Fácil aparecer" });
  realClick(card);

  await waitFor(() => {
    const el = document.getElementById("modalAutorizacoes");
    return el?.classList.contains("show") ? el : null;
  }, { timeoutMs: 10000, label: "modal Escolha um perfil abrir" });

  const container = document.getElementById("conteudoModalAutorizacoes");
  await waitFor(() => (container && container.textContent.includes("Acesso por procuração") ? true : null), {
    timeoutMs: 10000,
    label: "links de procuração carregarem no modal (AJAX)",
  });
  return container;
}

/** Todas as posições de procuração visíveis no modal agora. */
async function listProcuracaoPositions() {
  const container = await openAutoFiscoFacilModal();
  return collectProcuracaoLinks(container);
}

/**
 * Entra numa procuração chamando `chamaAplicacao(...)` diretamente no mundo
 * principal da página (via background, que tem `chrome.scripting` com
 * `world: "MAIN"`) — não depende de clique sintético disparar o onclick do
 * `<span>` corretamente, o que se mostrou inconsistente ao vivo (a 2ª
 * procuração em diante às vezes não navegava, sem erro nenhum). A própria
 * `chamaAplicacao` do site tem um bug conhecido (`janela is not defined`)
 * que dispara DEPOIS do `form.submit()` que realmente importa — inofensivo.
 */
async function enterProcuracao(grupo, posicao) {
  const container = await openAutoFiscoFacilModal();
  const links = collectProcuracaoLinks(container);
  const match = links.find((item) => item.grupo === grupo && item.posicao === posicao);
  if (!match) {
    throw new Error(`PROCURACAO_NAO_ENCONTRADA: grupo=${grupo} posicao=${posicao} (encontrados: ${links.length})`);
  }
  await chrome.runtime.sendMessage({ type: "INVOKE_CHAMA_APLICACAO", args: match.args });
  // Navega para fisco-facil.fazenda.rj.gov.br — content-fisco.js assume a partir daí.
}

(async () => {
  const certificado = await readCertificateHolderNameOnHome();
  if (certificado) await setConnectionStatus({ certificado, empresa: null, cnpj: null });

  const run = await getActiveRun();
  if (!run || run.step !== "NAVIGATE_HOME") return;

  if (run.mode === "SWEEP") {
    // Varredura completa: testa CADA procuração do modal (todos os grupos), sem alvo de CNPJ específico.
    try {
      let queue = run.sweepQueue;
      if (!queue) {
        queue = await listProcuracaoPositions();
        if (!queue.length) throw new Error("NENHUMA_PROCURACAO_ENCONTRADA_NO_MODAL");
        const response = await chrome.runtime.sendMessage({ type: "SET_SWEEP_QUEUE", queue });
        queue = response.queue;
      }
      const cursor = run.sweepCursor ?? 0;
      if (cursor >= queue.length) {
        await chrome.runtime.sendMessage({ type: "SWEEP_DONE" });
        return;
      }
      const current = queue[cursor];
      await enterProcuracao(current.grupo, current.posicao);
    } catch (error) {
      await chrome.runtime.sendMessage({ type: "REPORT_SWEEP_FAILURE", motivo: error.message });
    }
    return;
  }

  if (run.accessContext.type !== "PROCURACAO") {
    // Certificado próprio: exigiria trocar o certificado ativo no navegador,
    // algo que só o usuário pode fazer (seletor nativo do SO). Não implementado
    // ainda — precisa validar na PoC como fica o fluxo real nesse caso.
    await chrome.runtime.sendMessage({ type: "REPORT_FAILURE", motivo: "Estabelecimento usa certificado próprio — troca de certificado ainda não automatizada, verificar manualmente." });
    return;
  }

  try {
    if (run.accessContext.posicao != null) {
      // Posição já conhecida (índice ou cadastro manual) — vai direto, sem descoberta.
      await enterProcuracao(run.accessContext.grupo, run.accessContext.posicao);
      return;
    }

    // Posição desconhecida — modo descoberta: testa cada procuração até achar o CNPJ.
    // O background é quem guarda/avança o cursor da fila (persiste em activeRun).
    let discovery = run.discovery;
    if (!discovery) {
      const positions = await listProcuracaoPositions();
      const queue = run.accessContext.grupo ? positions.filter((p) => p.grupo === run.accessContext.grupo) : positions;
      if (!queue.length) throw new Error("NENHUMA_PROCURACAO_ENCONTRADA_NO_MODAL");
      const response = await chrome.runtime.sendMessage({ type: "SET_DISCOVERY_QUEUE", queue });
      discovery = response.discovery;
    }
    if (discovery.cursor >= discovery.queue.length) {
      throw new Error("CNPJ_NAO_ENCONTRADO_EM_NENHUMA_PROCURACAO_TESTADA");
    }
    const current = discovery.queue[discovery.cursor];
    await enterProcuracao(current.grupo, current.posicao);
  } catch (error) {
    await chrome.runtime.sendMessage({ type: "REPORT_FAILURE", motivo: error.message });
  }
})();
