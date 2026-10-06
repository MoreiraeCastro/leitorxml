// Roda no próprio portal (página Extensão). Faz a "conexão com um clique": o portal entrega o token à extensão
// por postMessage (mesma origem) e este script o repassa ao service worker, que o guarda. O token nunca aparece
// na tela nem passa pela área de transferência.
window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== "leitorxml-portal") return;
  const { type } = event.data;

  if (type === "PING") {
    const { paired } = await chrome.runtime.sendMessage({ type: "PAIRING_STATUS" }).catch(() => ({ paired: false }));
    window.postMessage({ source: "leitorxml-extensao", type: "PONG", paired: Boolean(paired) }, window.location.origin);
    return;
  }

  if (type === "PAIR") {
    const { token, apiBaseUrl } = event.data;
    const response = await chrome.runtime.sendMessage({ type: "PAIR_FROM_PORTAL", token, apiBaseUrl }).catch(() => ({ ok: false }));
    window.postMessage({ source: "leitorxml-extensao", type: "PAIRED", ok: Boolean(response?.ok) }, window.location.origin);
  }
});
