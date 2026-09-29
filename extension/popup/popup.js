const urlInput = document.getElementById("apiBaseUrl");
const tokenInput = document.getElementById("apiToken");
const statusEl = document.getElementById("status");

async function load() {
  const { apiBaseUrl, apiToken } = await chrome.storage.local.get(["apiBaseUrl", "apiToken"]);
  urlInput.value = apiBaseUrl ?? "http://localhost:3003/leitorxml";
  tokenInput.value = apiToken ?? "";
  const { run } = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_RUN" });
  statusEl.textContent = run ? `Em andamento: ${run.establishment?.razaoSocial ?? "?"} — ${run.tipoDocumento}/${run.papel}` : "Nenhuma tarefa em andamento.";
}

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.local.set({ apiBaseUrl: urlInput.value.trim(), apiToken: tokenInput.value.trim() });
  statusEl.textContent = "Salvo.";
});

document.getElementById("startNext").addEventListener("click", async () => {
  statusEl.textContent = "Buscando...";
  const response = await chrome.runtime.sendMessage({ type: "REQUEST_NEXT_TASK" });
  if (!response.ok) statusEl.textContent = `Erro: ${response.error}`;
  else if (!response.run) statusEl.textContent = "Nada pendente no momento.";
  else statusEl.textContent = `Iniciando: ${response.run.establishment.razaoSocial} — ${response.run.tipoDocumento}/${response.run.papel}`;
});

load();
