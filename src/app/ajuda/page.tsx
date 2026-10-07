import Link from "next/link";
import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { Shell } from "@/components/shell";

export const metadata = { title: "Ajuda" };

function Topic({ title, tag, open, children }: { title: string; tag?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-xl border border-black/10 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
        <span className="font-medium text-[#082240]">{title}</span>
        <span className="flex items-center gap-3">
          {tag && <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs text-black/50">{tag}</span>}
          <span className="text-black/40 transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
        </span>
      </summary>
      <div className="border-t border-black/5 px-5 py-4 text-sm leading-relaxed text-black/75">{children}</div>
    </details>
  );
}

const Steps = ({ children }: { children: React.ReactNode }) => <ol className="list-decimal space-y-1.5 pl-5">{children}</ol>;

const PROBLEMS: Array<[string, string]> = [
  ["“!” vermelho no ícone, ou “Abra o Fisco Fácil”", "Abra o Fisco Fácil, entre com o certificado e deixe a aba aberta."],
  ["“Falta conectar ao portal”", "No popup, clique em “Conectar ao portal” e depois em “Conectar esta extensão”."],
  ["“Algo deu errado”", "Clique em “Trabalhar agora” de novo. Se repetir, mande um print do popup."],
  ["Tela do Fisco Fácil falando em “IP” ou “bloqueio”", "Pare, feche o Fisco Fácil e espere 30 minutos. Avise o João."],
  ["Indicador girando há mais de 5 minutos", "Mande um print do popup (linha “Último passo”). Até 3 minutos ele se resolve sozinho."],
  ["Tarefa “Expirada” ou “Falha”", "Em Início, clique em “Pedir de novo” na etiqueta."],
  ["Arquivo não chegou ao SharePoint", "Confira se o PC está ligado, o OneDrive sincronizando e o Chrome aberto."],
];

export default async function AjudaPage() {
  const session = await requireOfficeSessionOrRedirect();
  return (
    <Shell session={session}>
      <h1 className="text-xl font-semibold text-[#082240]">Ajuda</h1>

      <section className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
        <h2 className="font-semibold">Em 30 segundos</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>Abra o Chrome e entre no <strong>Fisco Fácil</strong> com o certificado. Deixe a aba aberta.</li>
          <li>Veja o ícone da extensão: sem “!” vermelho, está tudo certo.</li>
          <li>Do <strong>dia 10</strong> em diante, clique em <strong>“Trabalhar agora”</strong> para pedir tudo.</li>
          <li>Em <Link href="/painel" className="underline">Início</Link>, revise os arquivos e marque como revisados.</li>
        </ol>
      </section>

      <div className="mt-5 space-y-3">
        <Topic title="Todo dia" tag="rotina">
          <Steps>
            <li>Ligue o computador, abra o Chrome e entre no <strong>Fisco Fácil</strong> com o certificado.</li>
            <li><strong>Deixe a aba aberta.</strong> Pode usar o resto do computador, mas não feche essa aba.</li>
            <li>Clique no ícone da extensão quando quiser ver como está:
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li><span className="font-medium text-emerald-700">Verde</span>: nada a fazer.</li>
                <li><span className="font-medium text-sky-700">Azul girando</span>: trabalhando. Não mexa na aba do Fisco Fácil.</li>
                <li><span className="font-medium text-amber-700">Amarelo</span>: entre no Fisco Fácil.</li>
                <li><span className="font-medium text-red-700">Vermelho</span>: veja “Algo deu errado”, abaixo.</li>
              </ul>
            </li>
          </Steps>
          <p className="mt-3 text-black/60">A extensão confere sozinha a cada uns 20 minutos (seg a sex, 7h às 20h). Quando há arquivo pronto, ela baixa, valida e salva na pasta do SharePoint.</p>
        </Topic>

        <Topic title="Pedir tudo do mês" tag="a partir do dia 10">
          <p className="mb-2">O sistema cria as 3 tarefas de cada empresa (NF-e emitente, NF-e destinatário e NFC-e) sozinho a partir do dia 10. Também dá para criar em Início → <em>Criar tarefas do mês</em>.</p>
          <Steps>
            <li>Em <Link href="/painel" className="underline">Início</Link>, veja “Pedir N tarefas”.</li>
            <li>Entre no Fisco Fácil com o certificado.</li>
            <li>Na extensão, clique em <strong>“Trabalhar agora”</strong>. Primeiro ela baixa o que já está pronto.</li>
            <li>Quando perguntar <strong>“Pedir agora?”</strong>, clique em OK. Ela passa de empresa em empresa sozinha. Não mexa na aba até acabar.</li>
            <li>Para interromper, clique em <strong>“Parar depois da etapa atual”</strong>. O que faltar continua na próxima vez.</li>
          </Steps>
          <p className="mt-3 text-amber-800">Pedir cria solicitações reais no Fisco Fácil. Se ele demorar demais ou mostrar bloqueio, pare e avise o João.</p>
          <p className="mt-2 text-black/60">O Fisco Fácil leva até <strong>5 dias</strong> para processar. Depois de pronto, o arquivo fica <strong>7 dias</strong>; passando disso, vira “Expirada” e precisa de “Pedir de novo”.</p>
        </Topic>

        <Topic title="Revisar" tag="quem confere">
          <Steps>
            <li>Em <Link href="/painel" className="underline">Início</Link>, clique na ficha <strong>Para revisar</strong>.</li>
            <li>Clique na etiqueta verde <strong>Revisar</strong> de uma empresa.</li>
            <li>Confira os documentos e a validação (<strong>OK</strong> é o esperado). Se quiser, clique em <strong>Baixar ZIP</strong>.</li>
            <li>Estando certo, clique em <strong>Marcar como revisado</strong>.</li>
          </Steps>
          <p className="mt-3 text-black/60">Se a validação disser QUARENTENA ou REJEITADO, não marque como revisado: avise o João.</p>
        </Topic>

        <Topic title="Onde ficam os arquivos">
          <p>No SharePoint, em <code>Tecnologia\Leitor de XML - Zips</code>: <code>CNPJ - Razão Social \ AAAA-MM \ arquivo.zip</code>. Em <Link href="/conexoes?aba=sharepoint" className="underline">Conexões → SharePoint</Link> você vê quantos já foram entregues.</p>
        </Topic>

        <Topic title="Algo deu errado" tag="problemas comuns" open>
          <div className="overflow-x-auto rounded-lg border border-black/10">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {PROBLEMS.map(([sintoma, acao]) => (
                  <tr key={sintoma} className="border-b border-black/5 align-top last:border-0">
                    <td className="w-2/5 px-4 py-3 font-medium text-black/80">{sintoma}</td>
                    <td className="px-4 py-3">{acao}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-black/60">Ao pedir ajuda, mande sempre um print do popup da extensão.</p>
        </Topic>

        <Topic title="Instalar a extensão" tag="uma vez por PC">
          <Steps>
            <li>No Chrome deste computador, entre no portal e abra <Link href="/conexoes" className="underline">Conexões</Link>. Clique em <strong>Baixar a extensão (ZIP)</strong>.</li>
            <li>Abra a pasta Downloads, clique com o botão direito em <code>leitor-de-xml-extensao.zip</code> e escolha <strong>Extrair tudo…</strong>.</li>
            <li>Na janela, apague o caminho que aparece e digite <code>C:\LeitorXML</code>. Clique em <strong>Extrair</strong>. Essa pasta precisa ficar sempre ali: não apague nem mude de lugar.</li>
            <li>No Chrome, digite <code>chrome://extensions</code> na barra de endereço e tecle Enter.</li>
            <li>Ligue <strong>Modo do desenvolvedor</strong> (canto superior direito).</li>
            <li>Clique em <strong>Carregar sem compactação</strong> e escolha a pasta <code>C:\LeitorXML</code> (a que tem o arquivo <code>manifest.json</code> dentro). A extensão “Leitor de XML — Fisco Fácil” aparece na lista, ligada.</li>
            <li>Clique no ícone de quebra-cabeça do Chrome (canto superior direito) e no <strong>alfinete</strong> ao lado da extensão, para o ícone ficar sempre visível.</li>
          </Steps>
          <p className="mt-3 text-black/60">Ao reabrir o Chrome, pode aparecer o aviso “Desativar extensões do modo de desenvolvedor”. Feche o aviso ou clique em <strong>Cancelar</strong>, sem desativar a extensão.</p>
          <p className="mt-2 text-black/60">Quando o João avisar de uma versão nova: baixe o ZIP de novo, extraia por cima de <code>C:\LeitorXML</code> (substituindo os arquivos) e, em <code>chrome://extensions</code>, clique no botão de recarregar (seta circular) da extensão.</p>
        </Topic>

        <Topic title="Preparar um computador" tag="uma vez por PC, depois de instalar">
          <Steps>
            <li>Em <Link href="/conexoes" className="underline">Conexões</Link>, clique em <strong>Conectar esta extensão</strong> (a extensão precisa estar instalada).</li>
            <li>Sincronize a biblioteca “arquivos” do SharePoint no OneDrive deste PC.</li>
            <li>Em <Link href="/conexoes?aba=sharepoint" className="underline">Conexões → SharePoint</Link>, copie o comando e cole no PowerShell (cria o atalho da pasta).</li>
            <li>No popup da extensão, ligue <strong>Acompanhamento automático</strong> e, em Configurações avançadas, <strong>Salvar os ZIPs na pasta do SharePoint</strong>.</li>
            <li>Nas configurações de energia do Windows, deixe o PC <strong>nunca suspender</strong> na tomada.</li>
          </Steps>
        </Topic>

        <Topic title="Regras de ouro">
          <ul className="list-disc space-y-1 pl-5">
            <li>Não feche o Chrome nem a aba do Fisco Fácil enquanto houver trabalho (principalmente do dia 10 ao 17).</li>
            <li>Não deixe o computador dormir.</li>
            <li>Nunca digite nem envie por mensagem a senha do certificado ou códigos de acesso.</li>
            <li>Na dúvida, pare e chame o João. Parar é sempre seguro.</li>
          </ul>
        </Topic>
      </div>
    </Shell>
  );
}
