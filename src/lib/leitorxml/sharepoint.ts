import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSharePointPath, type SharePointTarget } from "./sharepoint-path";

/**
 * Integração com o SharePoint via Microsoft Graph, em nome de uma conta do escritório (login delegado por
 * device code: o usuário autoriza uma vez no navegador e o servidor guarda só o refresh token, cifrado).
 * Não há segredo de aplicativo: o app registration é "cliente público".
 */

const SCOPES = "https://graph.microsoft.com/Files.ReadWrite.All https://graph.microsoft.com/Sites.ReadWrite.All offline_access";
const GRAPH = "https://graph.microsoft.com/v1.0";
/** Múltiplo de 320 KiB, como o Graph exige para os pedaços do upload em sessão. */
const UPLOAD_CHUNK_BYTES = 320 * 1024 * 12;
const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export class SharePointError extends Error {}

function config() {
  const tenant = process.env.SHAREPOINT_TENANT_ID;
  const clientId = process.env.SHAREPOINT_CLIENT_ID;
  const key = process.env.SHAREPOINT_TOKEN_KEY;
  if (!tenant || !clientId || !key) throw new SharePointError("SharePoint não configurado: faltam SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID ou SHAREPOINT_TOKEN_KEY no servidor.");
  const keyBuffer = Buffer.from(key, "base64");
  if (keyBuffer.length !== 32) throw new SharePointError("SHAREPOINT_TOKEN_KEY deve ser 32 bytes em base64.");
  return { tenant, clientId, key: keyBuffer };
}

export function sharePointConfigured() {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

function encrypt(plain: string): string {
  const { key } = config();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64")).join(".");
}

function decrypt(payload: string): string {
  const { key } = config();
  const [iv, tag, data] = payload.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export type SharePointConnection = {
  account: string | null;
  connectedAt: string | null;
  hasRefreshToken: boolean;
  loginPending: boolean;
  rootName: string | null;
  rootWebUrl: string | null;
  hasRootFolder: boolean;
};

type ConnectionRow = {
  account: string | null;
  refresh_token_enc: string | null;
  device_code_enc: string | null;
  device_expires_at: string | null;
  root_drive_id: string | null;
  root_item_id: string | null;
  root_web_url: string | null;
  root_name: string | null;
  connected_at: string | null;
};

async function loadRow(db: SupabaseClient): Promise<ConnectionRow | null> {
  const { data, error } = await db.from("xml_sharepoint_connection").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return (data as ConnectionRow | null) ?? null;
}

async function saveRow(db: SupabaseClient, patch: Partial<ConnectionRow>) {
  const { error } = await db.from("xml_sharepoint_connection").upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;
}

export async function getSharePointConnection(db: SupabaseClient): Promise<SharePointConnection> {
  const row = await loadRow(db);
  return {
    account: row?.account ?? null,
    connectedAt: row?.connected_at ?? null,
    hasRefreshToken: Boolean(row?.refresh_token_enc),
    loginPending: Boolean(row?.device_code_enc && row.device_expires_at && new Date(row.device_expires_at) > new Date()),
    rootName: row?.root_name ?? null,
    rootWebUrl: row?.root_web_url ?? null,
    hasRootFolder: Boolean(row?.root_drive_id && row?.root_item_id),
  };
}

/** Pronto para enviar arquivos: logado e com pasta de destino escolhida. */
export async function sharePointReady(db: SupabaseClient) {
  if (!sharePointConfigured()) return false;
  const connection = await getSharePointConnection(db);
  return connection.hasRefreshToken && connection.hasRootFolder;
}

// ---------- login (device code) ----------

export async function startDeviceLogin(db: SupabaseClient) {
  const { tenant, clientId } = config();
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPES }),
  });
  const body = (await response.json()) as { device_code?: string; user_code?: string; verification_uri?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !body.device_code || !body.user_code || !body.verification_uri) {
    throw new SharePointError(`Não foi possível iniciar o login: ${body.error_description?.split("\r")[0] ?? response.status}`);
  }
  await saveRow(db, { device_code_enc: encrypt(body.device_code), device_expires_at: new Date(Date.now() + (body.expires_in ?? 900) * 1000).toISOString() });
  return { userCode: body.user_code, verificationUri: body.verification_uri };
}

export type DevicePollResult = { status: "CONNECTED"; account: string | null } | { status: "PENDING" } | { status: "FAILED"; message: string };

export async function pollDeviceLogin(db: SupabaseClient): Promise<DevicePollResult> {
  const { tenant, clientId } = config();
  const row = await loadRow(db);
  if (!row?.device_code_enc) return { status: "FAILED", message: "Nenhum login em andamento. Clique em “Conectar” de novo." };
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: clientId, device_code: decrypt(row.device_code_enc) }),
  });
  const body = (await response.json()) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (body.error === "authorization_pending" || body.error === "slow_down") return { status: "PENDING" };
  if (!response.ok || !body.access_token || !body.refresh_token) {
    await saveRow(db, { device_code_enc: null, device_expires_at: null });
    return { status: "FAILED", message: body.error_description?.split("\r")[0] ?? body.error ?? `HTTP ${response.status}` };
  }
  const me = await fetch(`${GRAPH}/me?$select=userPrincipalName`, { headers: { authorization: `Bearer ${body.access_token}` } });
  const account = me.ok ? (((await me.json()) as { userPrincipalName?: string }).userPrincipalName ?? null) : null;
  await saveRow(db, { refresh_token_enc: encrypt(body.refresh_token), device_code_enc: null, device_expires_at: null, account, connected_at: new Date().toISOString() });
  return { status: "CONNECTED", account };
}

export async function disconnectSharePoint(db: SupabaseClient) {
  await saveRow(db, { refresh_token_enc: null, device_code_enc: null, device_expires_at: null, account: null, connected_at: null, root_drive_id: null, root_item_id: null, root_web_url: null, root_name: null });
}

// ---------- token de acesso ----------

async function getAccessToken(db: SupabaseClient): Promise<string> {
  const { tenant, clientId } = config();
  const row = await loadRow(db);
  if (!row?.refresh_token_enc) throw new SharePointError("SharePoint não conectado. Conecte em Portal → SharePoint.");
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: decrypt(row.refresh_token_enc), scope: SCOPES }),
  });
  const body = (await response.json()) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!response.ok || !body.access_token) {
    throw new SharePointError(`Login do SharePoint expirou ou foi revogado (${body.error ?? response.status}). Conecte de novo em Portal → SharePoint.`);
  }
  // O Graph rotaciona o refresh token: guarda o novo, senão o próximo uso falha.
  if (body.refresh_token) await saveRow(db, { refresh_token_enc: encrypt(body.refresh_token) });
  return body.access_token;
}

async function graph(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!response.ok) {
    const text = await response.text();
    throw new SharePointError(`Graph ${response.status}: ${text.slice(0, 300)}`);
  }
  return response;
}

// ---------- pasta de destino ----------

/** Converte o link copiado da barra de endereço (ou de "Copiar link") na pasta raiz de destino. */
export async function setRootFolderFromLink(db: SupabaseClient, link: string) {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new SharePointError("Link inválido.");
  }
  // Visão de biblioteca: .../Forms/AllItems.aspx?id=/sites/Site/Biblioteca/Pasta — o caminho real vem no parâmetro `id`.
  const idParam = url.searchParams.get("id");
  const isSharingLink = /\/:[a-z]:\//.test(url.pathname); // "Copiar link": https://tenant.sharepoint.com/:f:/s/Site/...
  const source = isSharingLink ? link.trim() : idParam ? `${url.origin}${idParam}` : `${url.origin}${url.pathname}`;
  const encoded = `u!${Buffer.from(source).toString("base64url")}`;
  const token = await getAccessToken(db);
  const item = (await (await graph(token, `/shares/${encoded}/driveItem?$select=id,name,webUrl,folder,parentReference`)).json()) as {
    id: string; name: string; webUrl: string; folder?: unknown; parentReference?: { driveId?: string };
  };
  if (!item.folder) throw new SharePointError("O link aponta para um arquivo, não para uma pasta.");
  if (!item.parentReference?.driveId) throw new SharePointError("Não foi possível identificar a biblioteca da pasta.");
  await saveRow(db, { root_drive_id: item.parentReference.driveId, root_item_id: item.id, root_web_url: item.webUrl, root_name: item.name });
  return { name: item.name, webUrl: item.webUrl };
}

// ---------- envio ----------

export { buildSharePointPath, safeSegment, type SharePointTarget } from "./sharepoint-path";

function encodePath(segments: string[]) {
  return segments.map(encodeURIComponent).join("/");
}

/** Grava o arquivo em <pasta raiz>/<empresa>/<AAAA-MM>/<arquivo>, criando as pastas que faltarem. Repetir o envio substitui o arquivo. */
export async function uploadToSharePoint(db: SupabaseClient, target: SharePointTarget, content: Buffer) {
  const row = await loadRow(db);
  if (!row?.root_drive_id || !row.root_item_id) throw new SharePointError("Escolha a pasta de destino em Portal → SharePoint.");
  const token = await getAccessToken(db);
  const { directory, filename } = buildSharePointPath(target);
  const relative = encodePath([...directory, filename]);
  const base = `/drives/${row.root_drive_id}/items/${row.root_item_id}:/${relative}`;

  let item: { id: string; webUrl: string };
  if (content.length <= SIMPLE_UPLOAD_MAX_BYTES) {
    const response = await graph(token, `${base}:/content?@microsoft.graph.conflictBehavior=replace`, { method: "PUT", headers: { "content-type": "application/zip" }, body: new Uint8Array(content) });
    item = (await response.json()) as { id: string; webUrl: string };
  } else {
    const session = (await (await graph(token, `${base}:/createUploadSession`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
    })).json()) as { uploadUrl: string };
    let last: Response | null = null;
    for (let start = 0; start < content.length; start += UPLOAD_CHUNK_BYTES) {
      const end = Math.min(start + UPLOAD_CHUNK_BYTES, content.length);
      // A URL da sessão já é pré-autorizada: não leva Authorization.
      last = await fetch(session.uploadUrl, {
        method: "PUT",
        headers: { "content-length": String(end - start), "content-range": `bytes ${start}-${end - 1}/${content.length}` },
        body: new Uint8Array(content.subarray(start, end)),
      });
      if (!last.ok) throw new SharePointError(`Upload em pedaços falhou (${last.status}): ${(await last.text()).slice(0, 200)}`);
    }
    item = (await last!.json()) as { id: string; webUrl: string };
  }
  return { itemId: item.id, webUrl: item.webUrl, path: [row.root_name ?? "", ...directory, filename].filter(Boolean).join("/") };
}

type TaskForSend = {
  id: string; storage_path_zip: string | null; tipo_documento: string; papel: string; competencia_ano: number; competencia_mes: number;
  sharepoint_item_id: string | null;
  xml_watch_establishments: { cnpj: string; razao_social: string; sharepoint_folder_path: string | null } | { cnpj: string; razao_social: string; sharepoint_folder_path: string | null }[] | null;
};

/**
 * Envia o ZIP em staging de uma tarefa pro SharePoint e registra o caminho. Falha NÃO derruba a tarefa:
 * ela segue em DISPONIVEL_REVISAO com o erro anotado, e a varredura tenta de novo.
 */
export async function sendTaskToSharePoint(db: SupabaseClient, taskId: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const { data, error } = await db
      .from("xml_collection_tasks")
      .select("id,storage_path_zip,tipo_documento,papel,competencia_ano,competencia_mes,sharepoint_item_id,xml_watch_establishments(cnpj,razao_social,sharepoint_folder_path)")
      .eq("id", taskId)
      .maybeSingle();
    if (error) throw error;
    const task = data as TaskForSend | null;
    if (!task?.storage_path_zip) throw new SharePointError("Tarefa sem arquivo em staging.");
    const establishment = Array.isArray(task.xml_watch_establishments) ? task.xml_watch_establishments[0] : task.xml_watch_establishments;
    if (!establishment) throw new SharePointError("Estabelecimento da tarefa não encontrado.");
    const download = await db.storage.from("leitorxml-staging").download(task.storage_path_zip);
    if (download.error || !download.data) throw new SharePointError("Não foi possível ler o arquivo do staging.");
    const buffer = Buffer.from(await download.data.arrayBuffer());
    const result = await uploadToSharePoint(db, {
      cnpj: establishment.cnpj, razaoSocial: establishment.razao_social, folderPath: establishment.sharepoint_folder_path,
      tipo: task.tipo_documento, papel: task.papel, ano: task.competencia_ano, mes: task.competencia_mes,
    }, buffer);
    await db.from("xml_collection_tasks").update({ sharepoint_item_id: result.itemId, sharepoint_path: result.path, erro_mensagem: null, updated_at: new Date().toISOString() }).eq("id", taskId);
    return { ok: true, path: result.path };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("xml_collection_tasks").update({ erro_mensagem: `SHAREPOINT: ${message}`.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", taskId);
    return { ok: false, error: message };
  }
}

/** Tarefas com ZIP validado em staging que ainda não foram pro SharePoint (usado pela varredura e pelo "enviar pendentes"). */
export async function sendPendingToSharePoint(db: SupabaseClient, limit = 20) {
  if (!(await sharePointReady(db))) return { attempted: 0, sent: 0, failed: 0, skipped: true };
  const { data, error } = await db
    .from("xml_collection_tasks")
    .select("id")
    .in("status", ["DISPONIVEL_REVISAO", "REVISADO"])
    .is("sharepoint_item_id", null)
    .not("storage_path_zip", "is", null)
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  let sent = 0;
  let failed = 0;
  for (const task of data ?? []) {
    const result = await sendTaskToSharePoint(db, task.id as string);
    if (result.ok) sent += 1;
    else failed += 1;
  }
  return { attempted: (data ?? []).length, sent, failed, skipped: false };
}
