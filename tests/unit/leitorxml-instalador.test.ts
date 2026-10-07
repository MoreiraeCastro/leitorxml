import { describe, expect, it } from "vitest";
import { buildInstallerBat } from "@/lib/leitorxml/instalador";

describe("buildInstallerBat", () => {
  const zip = Buffer.from("PK-fake-zip-content");
  const text = buildInstallerBat(zip).toString("utf8");
  const lines = text.split("\r\n");

  it("embute o ZIP em base64 e usa CRLF", () => {
    expect(text).toContain(zip.toString("base64"));
    expect(text).not.toMatch(/[^\r]\n/);
  });

  it("não começa com BOM (o cmd o leria como parte do primeiro comando)", () => {
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(lines[0]).toBe("@echo off");
  });

  it("a linha do cmd não escreve o marcador inteiro (senão o split cortaria nela)", () => {
    const command = lines.find((line) => line.startsWith("powershell"));
    expect(command).toBeDefined();
    expect(command).not.toContain("#PS#");
    expect(text.split("#PS#")).toHaveLength(3); // cabeçalho | script | final vazio
  });

  it("o cmd termina antes do script", () => {
    expect(text.indexOf("exit /b")).toBeLessThan(text.indexOf("$ErrorActionPreference"));
  });
});
