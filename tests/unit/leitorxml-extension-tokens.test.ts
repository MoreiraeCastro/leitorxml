import { describe, expect, it } from "vitest";
import { extractBearerToken, generateExtensionToken, hashExtensionToken } from "@/lib/leitorxml/extension-tokens";

describe("generateExtensionToken", () => {
  it("gera tokens únicos com o prefixo esperado", () => {
    const a = generateExtensionToken();
    const b = generateExtensionToken();
    expect(a).toMatch(/^lxml_/);
    expect(a).not.toEqual(b);
  });
});

describe("hashExtensionToken", () => {
  it("é determinístico para o mesmo token", () => {
    const token = generateExtensionToken();
    expect(hashExtensionToken(token)).toEqual(hashExtensionToken(token));
  });
  it("produz hashes diferentes para tokens diferentes", () => {
    expect(hashExtensionToken("a")).not.toEqual(hashExtensionToken("b"));
  });
});

describe("extractBearerToken", () => {
  it("extrai o token de um header Authorization válido", () => {
    expect(extractBearerToken("Bearer lxml_abc123")).toBe("lxml_abc123");
  });
  it("aceita variação de caixa em 'Bearer'", () => {
    expect(extractBearerToken("bearer lxml_abc123")).toBe("lxml_abc123");
  });
  it("retorna null sem header", () => {
    expect(extractBearerToken(null)).toBeNull();
  });
  it("retorna null para um header em formato diferente", () => {
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
  });
});
