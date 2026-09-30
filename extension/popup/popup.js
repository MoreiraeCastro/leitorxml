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
  if (run.mode === "SWEEP") {
    const total = run.sweepQueue?.length;
    const posicao = (run.sweepCursor ?? 0) + 1;
    return total ? `Varredura em andamento: procuração ${posicao}/${total}` : "Varredura em andamento: abrindo modal de procurações...";
  }
  return `Em andamento: ${run.establishment?.razaoSocial ?? "?"} — ${run.tipoDocumento}/${run.papel}`;
}

async function load() {
  const { apiBaseUrl, apiToken } = await chrome.storage.local.get(["apiBaseUrl", "apiToken"]);
  urlInput.value = apiBaseUrl ?? "http://localhost:3003/leitorxml";
  tokenInput.value = apiToken ?? "";
  const { run } = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_RUN" });
  const { lastSweepError } = await chrome.storage.session.get("lastSweepError");
  statusEl.textContent = describeRun(run) ?? (lastSweepError ? `Última varredura falhou: ${lastSweepError}` : "Nenhuma tarefa em andamento.");
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
    statusEl.textContent = `Iniciando: ${response.run.establishment.razaoSocial} — ${response.run.tipoDocumento}/${response.run.papel}`;
  }
});

load();
