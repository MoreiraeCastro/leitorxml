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
    { timeoutMs: 5000 },
  ).catch(() => null);
  return el?.textContent.trim() ?? null;
}

function findAutoFiscoFacilCard() {
  const heading = findByExactText("h5", "AUTO Fisco Fácil");
  return heading?.closest("a.card") ?? null;
}

/**
 * Varre #conteudoModalAutorizacoes em ordem de documento, agrupando os links
 * "Acesso por procuração" pelo cabeçalho de grupo mais recente visto antes
 * deles (ex.: "SUBFIN"). Heurístico — o HTML real do modal (conteúdo injetado
 * via AJAX) ainda não foi capturado; ajustar aqui se a estrutura divergir.
 */
function collectProcuracaoLinks(container) {
  const items = [];
  let currentGroup = null;
  let indexInGroup = 0;
  for (const el of container.querySelectorAll("*")) {
    const text = el.children.length === 0 ? el.textContent.trim() : "";
    if (!text) continue;
    if (text.toLowerCase().includes("acesso por procuração")) {
      indexInGroup += 1;
      items.push({ grupo: currentGroup, posicao: indexInGroup, element: el.closest("a,button") ?? el });
    } else if (text.length < 60) {
      // texto curto que não é o link em si — candidato a cabeçalho de grupo (ex.: "SUBFIN").
      currentGroup = text;
      indexInGroup = 0;
    }
  }
  return items;
}

/** Abre o modal "Escolha um perfil" e devolve o container com os links já carregados (AJAX). */
async function openAutoFiscoFacilModal() {
  const card = await waitFor(findAutoFiscoFacilCard, { timeoutMs: 10000 });
  realClick(card);

  await waitFor(() => {
    const el = document.getElementById("modalAutorizacoes");
    return el?.classList.contains("show") ? el : null;
  }, { timeoutMs: 10000 });

  const container = document.getElementById("conteudoModalAutorizacoes");
  await waitFor(() => (container && container.textContent.includes("Acesso por procuração") ? true : null), { timeoutMs: 10000 });
  return container;
}

/** Todas as posições de procuração visíveis no modal agora, sem os refs de elemento (não são serializáveis pra mandar pro background). */
async function listProcuracaoPositions() {
  const container = await openAutoFiscoFacilModal();
  return collectProcuracaoLinks(container).map(({ grupo, posicao }) => ({ grupo, posicao }));
}

async function clickProcuracaoPosition(grupo, posicao) {
  const container = await openAutoFiscoFacilModal();
  const links = collectProcuracaoLinks(container);
  const match = links.find((item) => item.grupo === grupo && item.posicao === posicao);
  if (!match) {
    throw new Error(`PROCURACAO_NAO_ENCONTRADA: grupo=${grupo} posicao=${posicao} (encontrados: ${links.length})`);
  }
  realClick(match.element);
  // Clicar navega para fisco-facil.fazenda.rj.gov.br — content-fisco.js assume a partir daí.
}

(async () => {
  const certificado = await readCertificateHolderNameOnHome();
  if (certificado) await setConnectionStatus({ certificado, empresa: null, cnpj: null });

  const run = await getActiveRun();
  if (!run || run.step !== "NAVIGATE_HOME") return;

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
      await clickProcuracaoPosition(run.accessContext.grupo, run.accessContext.posicao);
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
    await clickProcuracaoPosition(current.grupo, current.posicao);
  } catch (error) {
    await chrome.runtime.sendMessage({ type: "REPORT_FAILURE", motivo: error.message });
  }
})();
