import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parsePartitioned,
  partObjectPath,
  partitionedPath,
  readZip,
  removeZip,
  signZipLink,
  verifyZipLink,
  zipObjectPaths,
  zipResponse,
} from "@/lib/leitorxml/zip-storage";

/** Storage em memória com a mesma forma que o código usa (download/remove/createSignedUrl). */
function fakeStorage(objects: Record<string, Buffer>) {
  const removed: string[] = [];
  const bucket = {
    download: async (path: string) => (objects[path] ? { data: new Blob([new Uint8Array(objects[path])]), error: null } : { data: null, error: new Error("not found") }),
    remove: async (paths: string[]) => {
      removed.push(...paths);
      return { data: null, error: null };
    },
    createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}` }, error: null }),
  };
  const db = { storage: { from: () => bucket } } as unknown as SupabaseClient;
  return { db, removed };
}

const base = "tasks/t1/11111111-2222-3333-4444-555555555555.zip";

describe("caminhos de ZIP em partes", () => {
  it("monta e lê o caminho particionado", () => {
    const path = partitionedPath(base, 3);
    expect(path).toBe(`partes:3:${base}`);
    expect(parsePartitioned(path)).toEqual({ total: 3, base });
    expect(parsePartitioned(base)).toBeNull();
    expect(partObjectPath(base, 0)).toBe(`${base}.parte-001`);
    expect(zipObjectPaths(path)).toEqual([`${base}.parte-001`, `${base}.parte-002`, `${base}.parte-003`]);
    expect(zipObjectPaths(base)).toEqual([base]);
  });
});

describe("leitura e remoção", () => {
  it("remonta as partes na ordem certa", async () => {
    const { db } = fakeStorage({
      [partObjectPath(base, 0)]: Buffer.from("PK-a"),
      [partObjectPath(base, 1)]: Buffer.from("-b"),
      [partObjectPath(base, 2)]: Buffer.from("-c"),
    });
    expect((await readZip(db, partitionedPath(base, 3))).toString()).toBe("PK-a-b-c");
  });

  it("falha se faltar uma parte", async () => {
    const { db } = fakeStorage({ [partObjectPath(base, 0)]: Buffer.from("PK") });
    await expect(readZip(db, partitionedPath(base, 2))).rejects.toThrow("ZIP_PARTE_ILEGIVEL");
  });

  it("ZIP normal continua sendo um objeto só", async () => {
    const { db, removed } = fakeStorage({ [base]: Buffer.from("PKinteiro") });
    expect((await readZip(db, base)).toString()).toBe("PKinteiro");
    await removeZip(db, base);
    expect(removed).toEqual([base]);
  });

  it("remove todas as partes", async () => {
    const { db, removed } = fakeStorage({});
    await removeZip(db, partitionedPath(base, 2));
    expect(removed).toEqual([`${base}.parte-001`, `${base}.parte-002`]);
  });
});

describe("entrega em fluxo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("concatena as partes na resposta, com nome de download", async () => {
    const { db } = fakeStorage({});
    const conteudo: Record<string, string> = { [`https://storage.test/${base}.parte-001`]: "PK-um", [`https://storage.test/${base}.parte-002`]: "-dois" };
    vi.stubGlobal("fetch", async (url: string) => new Response(conteudo[url]));
    const response = await zipResponse(db, partitionedPath(base, 2), "empresa.zip");
    expect(response.headers.get("content-disposition")).toContain("empresa.zip");
    expect(await response.text()).toBe("PK-um-dois");
  });
});

describe("link assinado", () => {
  it("aceita o próprio link e recusa adulterado ou vencido", () => {
    process.env.SUPABASE_SECRET_KEY = "segredo-de-teste";
    const exp = Date.now() + 60_000;
    const sig = signZipLink("t1", exp);
    expect(verifyZipLink("t1", exp, sig)).toBe(true);
    expect(verifyZipLink("t2", exp, sig)).toBe(false);
    expect(verifyZipLink("t1", exp + 1, sig)).toBe(false);
    expect(verifyZipLink("t1", Date.now() - 1, signZipLink("t1", Date.now() - 1))).toBe(false);
    expect(verifyZipLink("t1", exp, "abc")).toBe(false);
  });
});
