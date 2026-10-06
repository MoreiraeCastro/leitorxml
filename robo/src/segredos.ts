import { readFile } from "node:fs/promises";
import readline from "node:readline";

/**
 * Onde o robô acha a senha do A1 e o token da API, em ordem de preferência:
 *  1. credencial do systemd ($CREDENTIALS_DIRECTORY/<nome>) — guardada CRIPTOGRAFADA em disco (systemd-creds) e só
 *     decifrada na memória do serviço enquanto ele roda;
 *  2. valor na variável de ambiente do PROCESSO (<NOME>), usada pelo robo/local.ps1, que o decifra do cofre do Windows;
 *  3. arquivo apontado por variável de ambiente (<NOME>_FILE), pra testes;
 *  4. digitação escondida no terminal (execução manual).
 * Nunca imprime nem grava o valor.
 */
export async function lerSegredo(nome: string, envValor: string, envFile: string, pergunta: string): Promise<string> {
  const doArquivo = async (caminho: string | undefined) => (caminho ? (await readFile(caminho, "utf8").catch(() => "")).replace(/\r?\n$/, "") : "");

  const dir = process.env.CREDENTIALS_DIRECTORY;
  const doSystemd = await doArquivo(dir ? `${dir}/${nome}` : undefined);
  if (doSystemd) return doSystemd;

  const doAmbiente = process.env[envValor];
  if (doAmbiente) return doAmbiente;

  const deArquivo = await doArquivo(process.env[envFile]);
  if (deArquivo) return deArquivo;

  if (!process.stdin.isTTY) throw new Error(`Segredo "${nome}" não encontrado (credencial do systemd, ${envValor}, ${envFile}) e não há terminal para perguntar.`);
  return perguntaEscondida(pergunta);
}

function perguntaEscondida(texto: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const state = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let mudo = false;
    state._writeToOutput = (s) => state.output.write(mudo ? "" : s);
    rl.question(texto, (resposta) => {
      rl.close();
      process.stdout.write("\n");
      resolve(resposta);
    });
    mudo = true;
  });
}
