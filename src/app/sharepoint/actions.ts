"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOfficeSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { SharePointError, disconnectSharePoint, pollDeviceLogin, sendPendingToSharePoint, sendTaskToSharePoint, setRootFolderFromLink, startDeviceLogin } from "@/lib/leitorxml/sharepoint";

export type SharePointActionState = { message: string | null; error: string | null; userCode?: string | null; verificationUri?: string | null };
const idle: SharePointActionState = { message: null, error: null };

function failure(error: unknown): SharePointActionState {
  return { ...idle, error: error instanceof SharePointError ? error.message : "Erro inesperado ao falar com o SharePoint." };
}

async function audit(userId: string, action: string, metadata: Record<string, unknown> = {}) {
  await createAdminClient().from("audit_logs").insert({ actor_user_id: userId, organization_id: null, actor_type: "OFFICE", action, entity: "xml_sharepoint_connection", entity_id: "1", safe_metadata: metadata });
}

export async function conectarSharePoint(): Promise<SharePointActionState> {
  const session = await requireOfficeSession();
  try {
    const login = await startDeviceLogin(createAdminClient());
    await audit(session.userId, "leitorxml_sharepoint_login_started");
    revalidatePath("/sharepoint");
    return { ...idle, userCode: login.userCode, verificationUri: login.verificationUri, message: "Abra o endereço, digite o código e autorize. Depois clique em “Já autorizei”." };
  } catch (error) {
    return failure(error);
  }
}

export async function confirmarLoginSharePoint(): Promise<SharePointActionState> {
  const session = await requireOfficeSession();
  try {
    const result = await pollDeviceLogin(createAdminClient());
    if (result.status === "PENDING") return { ...idle, message: "Ainda não foi autorizado. Conclua a autorização no navegador e clique de novo." };
    if (result.status === "FAILED") return { ...idle, error: result.message };
    await audit(session.userId, "leitorxml_sharepoint_connected", { account: result.account });
    revalidatePath("/sharepoint");
    return { ...idle, message: `Conectado como ${result.account ?? "conta Microsoft"}.` };
  } catch (error) {
    return failure(error);
  }
}

const linkSchema = z.string().trim().url().max(2000);

export async function definirPastaSharePoint(_prev: SharePointActionState, formData: FormData): Promise<SharePointActionState> {
  const session = await requireOfficeSession();
  const parsed = linkSchema.safeParse(formData.get("link"));
  if (!parsed.success) return { ...idle, error: "Cole o link completo da pasta do SharePoint." };
  try {
    const folder = await setRootFolderFromLink(createAdminClient(), parsed.data);
    await audit(session.userId, "leitorxml_sharepoint_folder_set", { name: folder.name });
    revalidatePath("/sharepoint");
    return { ...idle, message: `Pasta de destino: ${folder.name}.` };
  } catch (error) {
    return failure(error);
  }
}

export async function desconectarSharePoint() {
  const session = await requireOfficeSession();
  await disconnectSharePoint(createAdminClient());
  await audit(session.userId, "leitorxml_sharepoint_disconnected");
  revalidatePath("/sharepoint");
}

export async function enviarPendentesSharePoint(): Promise<SharePointActionState> {
  await requireOfficeSession();
  try {
    const result = await sendPendingToSharePoint(createAdminClient(), 50);
    revalidatePath("/sharepoint");
    if (result.skipped) return { ...idle, error: "Conecte o SharePoint e escolha a pasta de destino primeiro." };
    return { ...idle, message: `${result.attempted} pendente(s): ${result.sent} enviado(s), ${result.failed} com erro.` };
  } catch (error) {
    return failure(error);
  }
}

export async function enviarTarefaSharePoint(taskId: string) {
  await requireOfficeSession();
  const result = await sendTaskToSharePoint(createAdminClient(), taskId);
  revalidatePath(`/pedidos/${taskId}`);
  if (!result.ok) throw new Error(result.error);
}
