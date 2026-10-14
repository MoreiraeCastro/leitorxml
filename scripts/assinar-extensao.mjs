// Assina a versão da extensão que está no commit atual (HEAD) e grava extension-assinatura/assinatura.json.
//
// A atualização automática dos PCs (atualizador instalado pelo instalador .bat) só aceita um pacote cuja lista de
// arquivos e hashes bata com esta assinatura — assim, nem um servidor invadido consegue empurrar código pros PCs.
// A chave PRIVADA nunca vai pro repositório nem pro servidor: fica no PC de quem publica
// (padrão: %USERPROFILE%\.leitorxml-assinatura\chave-privada.pem; ou LEITORXML_CHAVE_PRIVADA).
//
// Uso (depois de commitar as mudanças da extensão):  node scripts/assinar-extensao.mjs
// Assina o conteúdo do Git (fim de linha LF, igual ao checkout do servidor), não a cópia de trabalho do Windows.
import { execFileSync } from "node:child_process";
import { createHash, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const git = (...args) => execFileSync("git", args, { maxBuffer: 64 * 1024 * 1024 });
const keyPath = process.env.LEITORXML_CHAVE_PRIVADA ?? path.join(homedir(), ".leitorxml-assinatura", "chave-privada.pem");

if (git("status", "--porcelain", "--", "extension").toString().trim()) {
  console.error("Há mudanças não commitadas em extension/ — commite antes de assinar (a assinatura vale para o HEAD).");
  process.exit(1);
}

// Mesmo conjunto que o servidor empacota (extension-package.ts): tudo de extension/, menos README.md.
const files = git("ls-tree", "-r", "--name-only", "HEAD", "--", "extension")
  .toString()
  .split("\n")
  .filter(Boolean)
  .map((full) => full.slice("extension/".length))
  .filter((relative) => path.posix.basename(relative) !== "README.md")
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); // ordinal, igual ao [StringComparer]::Ordinal do atualizador

const manifest = JSON.parse(git("show", "HEAD:extension/manifest.json").toString());
const arquivos = files.map((relative) => ({ caminho: relative, sha256: createHash("sha256").update(git("show", `HEAD:extension/${relative}`)).digest("hex") }));

// Texto canônico — o atualizador remonta exatamente este texto a partir dos arquivos baixados.
const canonical = ["leitorxml-extensao", `versao ${manifest.version}`, ...arquivos.map((file) => `${file.sha256} ${file.caminho}`)].join("\n");
const assinatura = sign("sha256", Buffer.from(canonical, "utf8"), readFileSync(keyPath)).toString("base64");

const outDir = path.join(process.cwd(), "extension-assinatura");
mkdirSync(outDir, { recursive: true });
const commit = git("rev-parse", "--short", "HEAD").toString().trim();
writeFileSync(path.join(outDir, "assinatura.json"), `${JSON.stringify({ versao: manifest.version, commit, arquivos, assinatura }, null, 2)}\n`);
console.log(`Assinada a versão ${manifest.version} (${arquivos.length} arquivos, commit ${commit}). Agora commite extension-assinatura/assinatura.json.`);
