const $ = (id) => document.getElementById(id);
const urlInput = $("apiBaseUrl");
const tokenInput = $("apiToken");

const say = (text) => { $("message").textContent = text ?? ""; };

function describeRun(run) {
  if (!run) return null;
  if (run.mode === "TRACK" && run.verifyOnly) return `Empresa: ${run.establishment?.razaoSocial ?? "?"} (conferindo as solicitações)`;
  if (run.mode === "TRACK") return `Empresa: ${run.establishment?.razaoSocial ?? "?"}`;
  if (run.mode === "SWEEP") {
    const total = run.sweepQueue?.length;
    return total ? `Atualizando procurações: ${(run.sweepCursor ?? 0) + 1} de ${total}` : "Atualizando procurações: abrindo a lista…";
  }
  const doc = run.tipoDocumento === "NFCE" ? "NFC-e" : "NF-e";
  const papel = run.papel === "EMITENTE" ? "Emitente" : "Destinatário";
  return `${doc} ${papel} · ${run.establishment?.razaoSocial ?? "?"}`;
}

function describeProgress(belt) {
  if (!belt?.active) return "";
  const falhas = belt.failed ? `, ${belt.failed} com problema` : "";
  const feito = belt.kind === "TRACK" ? `${belt.processed} empresa(s) conferida(s)` : `${belt.processed} solicitada(s)`;
  return `${feito}${falhas}${belt.stopRequested ? " — parando após a etapa atual" : ""}`;
}

/** Resume tudo numa frase de status: o que está acontecendo e se precisa de ação. */
function deriveHeadline({ run, belt, auto, hasToken, lastSweepError }) {
  if (!hasToken) return { tone: "warn", title: "Falta conectar ao portal", detail: "Clique em “Conectar ao portal” e, na página que abrir, em “Conectar esta extensão”. É só um clique." };
  if (run || belt?.active) {
    const title = belt?.kind === "TRACK" ? "Conferindo e baixando…" : run?.mode === "SWEEP" ? "Atualizando procurações…" : "Solicitando ao Fisco Fácil…";
    return { tone: "busy", busy: true, title, detail: [describeRun(run), describeProgress(belt)].filter(Boolean).join("\n") };
  }
  if (auto?.state === "PRECISA_ABRIR_FISCO") return { tone: "warn", title: "Abra o Fisco Fácil", detail: "Há arquivos para baixar, mas não encontrei o Fisco Fácil aberto. Entre com o certificado e deixe a aba aberta." };
  if (auto?.state === "ERRO") return { tone: "bad", title: "Algo deu errado", detail: auto.message ?? "Erro ao consultar o portal." };
  if (auto?.state === "CONCLUIDO") return { tone: auto.problem ? "bad" : "ok", title: auto.problem ? "Terminou com problemas" : "Tudo certo", detail: auto.message ?? "" };
  if (lastSweepError) return { tone: "bad", title: "Algo deu errado", detail: lastSweepError };
  if (belt?.summary && !belt.active) return { tone: belt.failed ? "warn" : "ok", title: belt.failed ? "Terminou com problemas" : "Tudo certo", detail: belt.summary };
  if (auto?.state === "NADA_A_FAZER") return { tone: "ok", title: "Tudo em dia", detail: "Nada para baixar ou conferir agora." };
  if (auto?.state === "FORA_DO_HORARIO") return { tone: "", title: "Pronto", detail: "Fora do horário automático (seg–sex, 7h–20h). Você ainda pode usar os botões." };
  if (auto?.state === "DESLIGADO") return { tone: "", title: "Automático desligado", detail: "Use os botões abaixo quando quiser conferir." };
  return { tone: "", title: "Pronto", detail: "Deixe o Chrome aberto com o Fisco Fácil logado: a conferência acontece sozinha." };
}

function describeLastNote(lastNote) {
  if (!lastNote?.step) return "";
  const seconds = Math.max(0, Math.round((Date.now() - lastNote.at) / 1000));
  const ago = seconds < 90 ? `há ${seconds}s` : `há ${Math.round(seconds / 60)} min`;
  return `Último passo (${ago}): ${lastNote.step}`;
}

function render({ run, belt, auto, hasToken, lastSweepError, connectionStatus, apiBaseUrl, autoEnabled, lastNote }) {
  const headline = deriveHeadline({ run, belt, auto, hasToken, lastSweepError });
  $("statusCard").className = `status ${headline.tone}`;
  const title = $("statusTitle");
  title.replaceChildren();
  if (headline.busy) {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    title.append(spinner);
  }
  title.append(headline.title);
  // Em andamento, mostra o último passo da extensão: se travar, é isso que a gente precisa ler.
  $("statusDetail").textContent = [headline.detail, headline.busy ? describeLastNote(lastNote) : ""].filter(Boolean).join("\n");

  const summary = auto?.summary;
  $("chips").hidden = !summary;
  if (summary) {
    $("chipReady").textContent = summary.paraBaixar;
    $("chipCheck").textContent = summary.aConferir;
    $("chipWait").textContent = summary.aguardandoSefaz;
  }

  const working = Boolean(run || belt?.active);
  $("workNow").hidden = working || !hasToken;
  $("connectPortal").hidden = hasToken;
  $("stopBelt").hidden = !belt?.active;
  $("startNext").disabled = !hasToken;
  $("startTracking").disabled = !hasToken;
  $("autoEnabled").checked = autoEnabled;

  const connection = $("connection");
  connection.replaceChildren();
  const label = document.createElement("span");
  label.textContent = "Fisco Fácil";
  const value = document.createElement("b");
  value.textContent = connectionStatus && (connectionStatus.certificado || connectionStatus.empresa)
    ? `${connectionStatus.certificado ?? "conectado"}${connectionStatus.empresa ? ` · ${connectionStatus.empresa}` : ""}`
    : "aba não detectada";
  connection.append(label, value);

  $("portalLink").href = `${apiBaseUrl.replace(/\/$/, "")}/painel`;
  $("updated").textContent = auto?.at ? `Verificado às ${new Date(auto.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "";
}

let inputsLoaded = false;
async function load() {
  const local = await chrome.storage.local.get(["apiBaseUrl", "apiToken", "autoTrack", "autoTrackEnabled", "robotMode", "autoRequestEnabled", "deliverToFolder"]);
  const apiBaseUrl = local.apiBaseUrl ?? "https://portalmoreiraecastro.com.br/leitorxml";
  // Só preenche os campos na 1ª vez: o popup se atualiza sozinho e não pode apagar o que a pessoa está digitando.
  if (!inputsLoaded) {
    urlInput.value = apiBaseUrl;
    tokenInput.value = local.apiToken ?? "";
    $("robotMode").checked = Boolean(local.robotMode);
    $("autoRequest").checked = Boolean(local.autoRequestEnabled);
    $("deliverToFolder").checked = Boolean(local.deliverToFolder);
    inputsLoaded = true;
  }
  const { run } = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_RUN" });
  const { lastSweepError, belt, connectionStatus, lastNote } = await chrome.storage.session.get(["lastSweepError", "belt", "connectionStatus", "lastNote"]);
  render({ run, belt, auto: local.autoTrack, hasToken: Boolean(local.apiToken), lastSweepError, connectionStatus, apiBaseUrl, autoEnabled: local.autoTrackEnabled ?? true, lastNote });
}

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({ apiBaseUrl: urlInput.value.trim(), apiToken: tokenInput.value.trim() });
  say("Configurações salvas.");
  await load();
});

$("robotMode").addEventListener("change", async (event) => {
  await chrome.storage.local.set({ robotMode: event.target.checked });
  say(event.target.checked ? "Modo PC robô ligado: abre o Fisco Fácil e trabalha sozinho." : "Modo PC robô desligado.");
});

$("deliverToFolder").addEventListener("change", async (event) => {
  if (event.target.checked && !confirm("Só ligue se este PC tem OneDrive e você já rodou o comando do portal (Conexões → SharePoint) que liga a pasta Downloads\\Leitor de XML ao SharePoint.\n\nO comando já foi rodado?")) {
    event.target.checked = false;
    return;
  }
  await chrome.storage.local.set({ deliverToFolder: event.target.checked });
  say(event.target.checked ? "Esta pasta agora envia os ZIPs ao SharePoint (via OneDrive)." : "Este PC volta a só guardar os ZIPs em Downloads.");
});

$("autoRequest").addEventListener("change", async (event) => {
  // Cria solicitações REAIS sem ninguém clicando: só liga depois de confirmar.
  if (event.target.checked && !confirm("A extensão passará a PEDIR documentos de verdade no Fisco Fácil sozinha, a partir do dia 10 de cada mês.\n\nLigar?")) {
    event.target.checked = false;
    return;
  }
  await chrome.storage.local.set({ autoRequestEnabled: event.target.checked });
  say(event.target.checked ? "Solicitação automática ligada (a partir do dia 10)." : "Solicitação automática desligada.");
});

$("autoEnabled").addEventListener("change", async (event) => {
  await chrome.storage.local.set({ autoTrackEnabled: event.target.checked });
  say(event.target.checked ? "Acompanhamento automático ligado." : "Acompanhamento automático desligado.");
  await load();
});

$("autoNow").addEventListener("click", async () => {
  say("Verificando se há algo para baixar…");
  const response = await chrome.runtime.sendMessage({ type: "AUTO_TRACK_NOW" });
  say(response.ok ? "" : `Erro: ${response.error}`);
  await load();
});

$("startSweep").addEventListener("click", async () => {
  say("Iniciando a atualização das procurações…");
  const response = await chrome.runtime.sendMessage({ type: "START_SWEEP" });
  say(response.ok ? "" : `Erro: ${response.error}`);
  await load();
});

$("connectPortal").addEventListener("click", async () => {
  const { apiBaseUrl } = await chrome.storage.local.get("apiBaseUrl");
  await chrome.tabs.create({ url: `${(apiBaseUrl ?? "https://portalmoreiraecastro.com.br/leitorxml").replace(/\/$/, "")}/conexoes` });
});

$("workNow").addEventListener("click", async () => {
  say("Vendo o que há para fazer…");
  let response = await chrome.runtime.sendMessage({ type: "WORK_NOW" });
  if (response.needsConfirm) {
    // Nada a baixar, mas há tarefas ainda não pedidas: pedir cria solicitações REAIS, então confirma antes.
    if (!confirm(`Há ${response.needsConfirm.agendadas} solicitações ainda não pedidas ao Fisco Fácil.\n\nPedir agora, empresa por empresa?`)) {
      say("");
      return;
    }
    response = await chrome.runtime.sendMessage({ type: "WORK_NOW", confirmRequest: true });
  }
  if (response.error === "JA_TEM_TAREFA_EM_ANDAMENTO") say("Já tem uma tarefa em andamento — espere terminar.");
  else if (response.error === "PRECISA_ABRIR_FISCO") say("Abra o Fisco Fácil, entre com o certificado e clique de novo.");
  else if (!response.ok) say(`Erro: ${response.error}`);
  else if (response.nothing) say("Nada a fazer agora.");
  else say("");
  await load();
});

$("startTracking").addEventListener("click", async () => {
  say("Procurando o que conferir…");
  const response = await chrome.runtime.sendMessage({ type: "START_TRACKING" });
  if (response.error === "JA_TEM_TAREFA_EM_ANDAMENTO") say("Já tem uma tarefa em andamento — espere terminar.");
  else if (!response.ok) say(`Erro: ${response.error}`);
  else if (!response.run) say("Nada para conferir agora.");
  else say("");
  await load();
});

$("startNext").addEventListener("click", async () => {
  // Cria solicitações REAIS no Fisco Fácil, empresa por empresa, até a fila acabar: nunca por engano.
  if (!confirm("Isso vai PEDIR documentos de verdade no Fisco Fácil, empresa por empresa, até acabar a fila.\n\nContinuar?")) return;
  say("Buscando a próxima solicitação…");
  const response = await chrome.runtime.sendMessage({ type: "REQUEST_NEXT_TASK" });
  if (response.error === "JA_TEM_TAREFA_EM_ANDAMENTO") say("Já tem uma tarefa em andamento — espere terminar.");
  else if (!response.ok) say(`Erro: ${response.error}`);
  else if (!response.run) say("Não há nada para solicitar agora.");
  else say("");
  await load();
});

$("stopBelt").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "STOP_BELT" });
  say(response.wasActive ? "Parando depois da etapa atual…" : "Nada em andamento.");
  await load();
});

load();
// O popup acompanha o andamento sozinho enquanto está aberto.
setInterval(load, 2000);
