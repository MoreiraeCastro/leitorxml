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

async function reportEvento(taskId, body) {
  await apiFetch(`/api/leitorxml/extensao/tarefas/${taskId}/eventos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function reportFalha(taskId, motivo) {
  await apiFetch(`/api/leitorxml/extensao/tarefas/${taskId}/falha`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motivo }),
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
        case "EXPECT_DOWNLOAD": {
          const run = await getActiveRun();
          if (run) expectedDownloadTaskId = run.taskId;
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
