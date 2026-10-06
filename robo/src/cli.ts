import { PortalApi } from "./api.ts";
import { FiscoSession } from "./fisco.ts";
import { rastrear } from "./rastrear.ts";
import { lerSegredo } from "./segredos.ts";

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);
const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

async function main() {
  if (process.argv[2] !== "rastrear") {
    console.error("Uso: node robo/src/cli.ts rastrear [--stale-horas 20] [--max-empresas 200] [--max-minutos 180]");
    process.exit(1);
  }
  const apiUrl = process.env.ROBO_API_URL ?? "https://portalmoreiraecastro.com.br/leitorxml";
  const pfxPath = process.env.ROBO_PFX ?? "segredos/certificado.pfx";
  const staleHoras = Number(arg("stale-horas", "20"));
  const maxEmpresas = Number(arg("max-empresas", "200"));
  const maxMinutos = Number(arg("max-minutos", "180"));

  const token = await lerSegredo("robo-token", "ROBO_TOKEN", "ROBO_TOKEN_FILE", "Token do robô (gerado no portal, em Extensão): ");
  const passphrase = await lerSegredo("a1pass", "ROBO_A1PASS", "ROBO_A1PASS_FILE", "Senha do certificado A1 (não aparece enquanto digita): ");

  const session = await FiscoSession.open({ pfxPath, passphrase, log });
  try {
    const resultado = await rastrear({
      session,
      api: new PortalApi(apiUrl, token),
      staleHours: staleHoras,
      maxEmpresas,
      deadlineAt: Date.now() + maxMinutos * 60_000,
      log,
    });
    log(`RESUMO: ${JSON.stringify(resultado)}`);
    process.exitCode = resultado.empresasComFalha && !resultado.empresasConferidas ? 2 : 0;
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(`${new Date().toISOString()} ERRO FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
