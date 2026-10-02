const urlInput = document.getElementById("apiBaseUrl");
const tokenInput = document.getElementById("apiToken");
const statusEl = document.getElementById("status");
const connectionStatusEl = document.getElementById("connectionStatus");

function renderConnectionStatus(connectionStatus) {
  if (!connectionStatus || (!connectionStatus.certificado && !connectionStatus.empresa)) {
    connectionStatusEl.innerHTML = `<div class="empty">Nenhuma aba do Fisco Fácil/SEFAZ detectada ainda.</div>`;
    return;
  }
  const { certificado, empresa, cnpj } = connectionStatus;
  connectionStatusEl.innerHTML = `
    <div class="row"><span class="label">Certificado conectado</span><span class="value">${certificado ?? "—"}</span></div>
    <div class="row"><span class="label">Empresa selecionada</span><span class="value">${empresa ? `${empresa}${cnpj ? ` (${cnpj})` : ""}` : "—"}</span></div>
  `;
}

function describeRun(run) {
  if (!run) return null;
  if (run.mode === "TRACK") return `Conferindo resultados: ${run.establishment?.razaoSocial ?? "?"} (empresa ${run.trackCount ?? 1})`;
  if (run.mode === "SWEEP") {
    const total = run.sweepQueue?.length;
    const posicao = (run.sweepCursor ?? 0) + 1;
    return total ? `Varredura em andamento: procuração ${posicao}/${total}` : "Varredura em andamento: abrindo modal de procurações...";
  }
  return `Em andamento: ${run.establishment?.razaoSocial ?? "?"} — ${run.tipoDocumento}/${run.papel}`;
}

function describeBelt(belt) {
  if (!belt) return "";
  const progresso = `${belt.processed} solicitada(s), ${belt.failed} falha(s)`;
  if (belt.active) return `\nEsteira ativa: ${progresso}${belt.stopRequested ? " — parando após a tarefa atual" : ""}`;
  return belt.summary ? `\n${belt.summary}` : "";
}

async function load() {
  const { apiBaseUrl, apiToken } = await chrome.storage.local.get(["apiBaseUrl", "apiToken"]);
  urlInput.value = apiBaseUrl ?? "http://localhost:3003/leitorxml";
  tokenInput.value = apiToken ?? "";
  const { run } = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_RUN" });
  const { lastSweepError, belt } = await chrome.storage.session.get(["lastSweepError", "belt"]);
  statusEl.textContent = (describeRun(run) ?? (lastSweepError ? `Último erro: ${lastSweepError}` : "Nenhuma tarefa em andamento.")) + describeBelt(belt);
  const { connectionStatus } = await chrome.storage.session.get("connectionStatus");
  renderConnectionStatus(connectionStatus);
}

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.local.set({ apiBaseUrl: urlInput.value.trim(), apiToken: tokenInput.value.trim() });
  statusEl.textContent = "Salvo.";
});

document.getElementById("startSweep").addEventListener("click", async () => {
  statusEl.textContent = "Iniciando varredura...";
  const response = await chrome.runtime.sendMessage({ type: "START_SWEEP" });
  statusEl.textContent = response.ok ? describeRun(response.run) : `Erro: ${response.error}`;
});

document.getElementById("startTracking").addEventListener("click", async () => {
  statusEl.textContent = "Procurando solicitações a conferir...";
  const response = await chrome.runtime.sendMessage({ type: "START_TRACKING" });
  if (response.error === "JA_TEM_TAREFA_EM_ANDAMENTO") statusEl.textContent = `Já tem uma corrida em andamento — espera terminar.\n${describeRun(response.run)}`;
  else if (!response.ok) statusEl.textContent = `Erro: ${response.error}`;
  else if (!response.run) statusEl.textContent = "Nenhuma solicitação pendente de conferência.";
  else statusEl.textContent = describeRun(response.run);
});

document.getElementById("stopBelt").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "STOP_BELT" });
  statusEl.textContent = response.wasActive ? "Parando a esteira depois da tarefa atual..." : "A esteira não está ativa.";
});

document.getElementById("startNext").addEventListener("click", async () => {
  statusEl.textContent = "Buscando...";
  const response = await chrome.runtime.sendMessage({ type: "REQUEST_NEXT_TASK" });
  if (response.error === "JA_TEM_TAREFA_EM_ANDAMENTO") {
    statusEl.textContent = `Já tem uma tarefa em andamento — espera terminar antes de buscar outra.\n${describeRun(response.run)}`;
  } else if (!response.ok) {
    statusEl.textContent = `Erro: ${response.error}`;
  } else if (!response.run) {
    statusEl.textContent = "Nada pendente no momento.";
  } else {
    statusEl.textContent = `Esteira iniciada: ${response.run.establishment.razaoSocial} — ${response.run.tipoDocumento}/${response.run.papel}\nVai até a fila acabar; use \"Parar esteira\" para interromper.`;
  }
});

load();
