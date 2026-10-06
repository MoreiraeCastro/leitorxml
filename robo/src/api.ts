import { assertLooksLikeZip, type TrackedTask } from "./solicitacoes.ts";

export type AccessContext = { type: "PROCURACAO"; grupo: string | null; posicao: number | null } | { type: "PROPRIO" };
export type TrackingBatch = {
  establishment: { id: string; cnpj: string; razaoSocial: string; situacaoCadastral: string | null } | null;
  accessContext?: AccessContext;
  tasks?: TrackedTask[];
};

/** Cliente da API do portal — as MESMAS rotas que a extensão usa (o robô é só mais um cliente, com o seu próprio token). */
export class PortalApi {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  private async call(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new Error(`API_${response.status} em ${path.split("?")[0]}: ${(await response.text()).slice(0, 200)}`);
    return response;
  }

  /** Próxima empresa com solicitações a conferir (a API trava a empresa pra este usuário). */
  async nextTrackingCompany(visited: string[], staleHours: number | null): Promise<TrackingBatch> {
    const params = new URLSearchParams();
    if (visited.length) params.set("exclude", visited.join(","));
    if (staleHours != null) params.set("staleHours", String(staleHours));
    const query = params.toString() ? `?${params}` : "";
    return (await this.call(`/api/leitorxml/extensao/acompanhamento${query}`)).json() as Promise<TrackingBatch>;
  }

  async report(taskId: string, status: string, sefazReferencia?: string) {
    await this.call(`/api/leitorxml/extensao/tarefas/${taskId}/eventos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(sefazReferencia ? { sefazReferencia } : {}) }),
    });
  }

  async fail(taskId: string, motivo: string) {
    await this.call(`/api/leitorxml/extensao/tarefas/${taskId}/falha`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo: motivo.slice(0, 3900) }),
    });
  }

  async uploadZip(taskId: string, bytes: Uint8Array) {
    assertLooksLikeZip(bytes);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/zip" }), "extracao.zip");
    return (await this.call(`/api/leitorxml/extensao/tarefas/${taskId}/upload`, { method: "POST", body: form })).json() as Promise<{ ok: boolean; resultadoValidacao: string; documentCount: number }>;
  }
}
