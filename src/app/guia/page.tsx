import Link from "next/link";
import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { Shell } from "@/components/shell";

export const metadata = { title: "Guia do dia a dia" };

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="mt-3 list-decimal space-y-2 pl-6 text-sm leading-relaxed text-black/80">{children}</ol>;
}

function Section({ id, title, who, children }: { id: string; title: string; who?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-8 scroll-mt-6 rounded border border-black/10 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-[#082240]">{title}</h2>
        {who && <span className="rounded-full bg-black/5 px-3 py-0.5 text-xs text-black/60">{who}</span>}
      </div>
      {children}
    </section>
  );
}

function Note({ tone = "info", children }: { tone?: "info" | "warn" | "danger"; children: React.ReactNode }) {
  const cls = { info: "border-sky-200 bg-sky-50 text-sky-900", warn: "border-amber-200 bg-amber-50 text-amber-900", danger: "border-red-200 bg-red-50 text-red-800" }[tone];
  return <div className={`mt-3 rounded border px-4 py-3 text-sm leading-relaxed ${cls}`}>{children}</div>;
}

const PROBLEMS: Array<[string, string]> = [
  ["Ícone da extensão com “!” vermelho, ou o popup diz “Abra o Fisco Fácil”", "Abra o Fisco Fácil, entre com o certificado e deixe a aba aberta. Pronto: o automático volta sozinho."],
  ["Popup diz “Falta conectar ao portal”", "Clique em “Conectar ao portal”. Na página que abrir, clique em “Conectar esta extensão”."],
  ["Popup diz “Algo deu errado”", "Leia a mensagem, clique em “Trabalhar agora” de novo. Se repetir, tire um print do popup e mande para o João."],
  ["A tela do Fisco Fácil mostra um texto sobre “endereços IP” ou “mensagem de bloqueio”", "Pare (botão “Parar depois da etapa atual”), feche o Fisco Fácil e espere 30 minutos. Avise o João. Não fique tentando de novo."],
  ["Indicador girando por mais de 5 minutos", "O sistema desiste sozinho depois de uns 3 minutos e segue para a próxima empresa. Se passar de 5, tire um print do popup (com a linha “Último passo”) e mande para o João."],
  ["Uma tarefa aparece como “Expirada”", "O arquivo passou dos 7 dias no Fisco Fácil e precisa ser pedido de novo. Avise o João."],
  ["O arquivo não apareceu no SharePoint", "Confirme que o computador está ligado, que o ícone do OneDrive (nuvem) não está parado e que o Chrome ficou aberto. Se mesmo assim não chegar, avise o João."],
];

export default async function GuiaPage() {
  const session = await requireOfficeSessionOrRedirect();
  return (
    <Shell session={session}>
      <h1 className="text-lg font-semibold text-[#082240]">Guia do dia a dia</h1>
      <p className="mt-1 text-sm text-black/60">Como operar o Leitor de XML: o que fazer todo dia, como pedir tudo no começo do mês e o que fazer quando algo não vai bem.</p>

      <div className="mt-5 rounded border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="text-base font-semibold text-emerald-900">Em 30 segundos</h2>
        <ol className="mt-3 list-decimal space-y-1.5 pl-6 text-sm leading-relaxed text-emerald-900">
          <li>Abra o Chrome e entre no <strong>Fisco Fácil</strong> com o certificado. <strong>Deixe a aba aberta.</strong></li>
          <li>Olhe o ícone da extensão <strong>Leitor de XML</strong> (a peça de quebra-cabeça do Chrome). Sem “!” vermelho, está tudo certo: ela confere e baixa sozinha.</li>
          <li>A partir do <strong>dia 10</strong>: clique na extensão e em <strong>“Trabalhar agora”</strong> para pedir tudo.</li>
          <li>No portal, abra o <strong>Painel</strong>, revise os arquivos e clique em <strong>“Marcar como revisado”</strong>.</li>
        </ol>
        <p className="mt-3 text-xs text-emerald-800">Atalhos: <a className="underline" href="#preparar">preparar o computador</a> · <a className="underline" href="#dia">todo dia</a> · <a className="underline" href="#pedir">pedir tudo</a> · <a className="underline" href="#revisar">revisar</a> · <a className="underline" href="#problemas">problemas</a></p>
      </div>

      <Section id="preparar" title="1. Preparar o computador" who="uma vez por computador (João ou TI)">
        <Steps>
          <li><strong>Extensão instalada e ligada.</strong> Em <code>chrome://extensions</code>, o cartão “Leitor de XML — Fisco Fácil” deve estar ligado. Depois de qualquer atualização, clique na seta de <strong>recarregar</strong> do cartão.</li>
          <li><strong>Conectar ao portal.</strong> No menu <Link className="underline" href="/extensao">Extensão</Link>, clique em <strong>“Conectar esta extensão”</strong>. Não precisa copiar nada.</li>
          <li><strong>Sincronizar o SharePoint.</strong> A biblioteca “arquivos” precisa estar sincronizada no OneDrive deste computador, e a pasta <code>Tecnologia\Leitor de XML - Zips</code> precisa aparecer no Explorador de Arquivos.</li>
          <li><strong>Criar o atalho da pasta.</strong> No menu <Link className="underline" href="/sharepoint">SharePoint</Link>, clique em <strong>“Copiar comando”</strong>, abra o <strong>PowerShell</strong> e cole. Isso liga a pasta <code>Downloads\Leitor de XML</code> à pasta do SharePoint.</li>
          <li><strong>Ligar os dois interruptores</strong> no popup da extensão: <em>“Acompanhamento automático”</em> (na tela principal) e, em “Configurações avançadas”, <em>“Salvar os ZIPs na pasta do SharePoint”</em>.</li>
          <li><strong>Energia.</strong> Em Configurações do Windows → Sistema → Energia, ajuste para o computador <strong>nunca suspender</strong> enquanto está na tomada. Se ele dormir, nada é baixado.</li>
        </Steps>
        <Note>Só os computadores que rodam a extensão precisam disso. Para apenas revisar no portal, não precisa de nada.</Note>
      </Section>

      <Section id="dia" title="2. Todo dia" who="quem opera">
        <Steps>
          <li>Ligue o computador e abra o <strong>Chrome</strong>.</li>
          <li>Abra o <strong>Fisco Fácil</strong> e entre com o certificado (se o Chrome pedir, escolha o certificado do escritório).</li>
          <li><strong>Deixe a aba do Fisco Fácil aberta.</strong> Pode usar o resto do computador normalmente, mas não feche essa aba nem o Chrome.</li>
          <li>De vez em quando, clique no ícone da extensão. A mensagem do topo diz o que está acontecendo:
            <ul className="mt-2 list-disc space-y-1 pl-5 text-black/70">
              <li><strong className="text-emerald-700">Tudo em dia / Tudo certo</strong> (verde): nada a fazer.</li>
              <li><strong className="text-sky-700">Conferindo e baixando… / Solicitando…</strong> (azul, girando): está trabalhando. Não mexa na aba do Fisco Fácil.</li>
              <li><strong className="text-amber-700">Abra o Fisco Fácil</strong> (amarelo): entre com o certificado.</li>
              <li><strong className="text-red-700">Algo deu errado</strong> (vermelho): veja a seção <a className="underline" href="#problemas">Problemas</a>.</li>
            </ul>
          </li>
        </Steps>
        <Note>A extensão confere o Fisco Fácil sozinha a cada uns 20 minutos, de segunda a sexta, das 7h às 20h. Quando há arquivo pronto, ela baixa, valida e salva na pasta do SharePoint sem ninguém clicar.</Note>
      </Section>

      <Section id="pedir" title="3. Pedir tudo (a partir do dia 10)" who="uma vez por mês">
        <p className="mt-3 text-sm leading-relaxed text-black/70">Cada empresa tem <strong>3 pedidos</strong> por mês: NF-e Emitente, NF-e Destinatário e NFC-e Emitente. O sistema cria essas tarefas sozinho a partir do dia 10 (a cada 3 dias), para o mês anterior. Se precisar criar à mão, use o menu <Link className="underline" href="/extracao/nova">Nova extração</Link>.</p>
        <Steps>
          <li>No <Link className="underline" href="/painel">Painel</Link>, veja o quadro <strong>“Ainda não solicitadas”</strong>. Se tiver número maior que zero, há o que pedir.</li>
          <li>Entre no <strong>Fisco Fácil</strong> com o certificado.</li>
          <li>Clique no ícone da extensão e em <strong>“Trabalhar agora”</strong>. Primeiro ela baixa o que já estiver pronto.</li>
          <li>Quando não houver mais nada a baixar, ela pergunta: <strong>“Há N solicitações ainda não pedidas. Pedir agora?”</strong> Clique em <strong>OK</strong>.</li>
          <li>Ela passa de empresa em empresa sozinha, fazendo os 3 pedidos de cada uma e conferindo a aba “Solicitações” antes de sair. <strong>Não mexa na aba do Fisco Fácil</strong> até acabar. Dá para acompanhar pelo popup, que mostra a empresa atual.</li>
          <li>Se precisar interromper, clique em <strong>“Parar depois da etapa atual”</strong>. O que faltar fica para a próxima vez: é só clicar em “Trabalhar agora” de novo.</li>
        </Steps>
        <Note tone="warn">Pedir cria <strong>solicitações reais</strong> no Fisco Fácil. Por isso o sistema sempre pergunta antes. Se o Fisco Fácil começar a demorar demais ou mostrar uma página de bloqueio, <strong>pare</strong> e avise o João, sem insistir.</Note>
        <p className="mt-4 text-sm font-medium text-black/80">Depois de pedir</p>
        <ul className="mt-2 list-disc space-y-1 pl-6 text-sm leading-relaxed text-black/70">
          <li>O Fisco Fácil pode levar <strong>até 5 dias</strong> para processar (perto do dia 11 costuma demorar mais). Não é preciso fazer nada: a extensão confere sozinha e baixa quando ficar “Processada”.</li>
          <li>Depois de pronto, o arquivo fica disponível por <strong>7 dias</strong>. Passando disso vira <strong>“Expirada”</strong> e precisa ser pedido de novo, por isso é importante deixar o Chrome aberto nesses dias.</li>
        </ul>
        <Note>Se o João ligar a opção <em>“Solicitar automaticamente a partir do dia 10”</em> (Configurações avançadas da extensão), a extensão faz esse passo sozinha, sem ninguém clicar em “Trabalhar agora”.</Note>
      </Section>

      <Section id="revisar" title="4. Revisar" who="quem confere os arquivos">
        <Steps>
          <li>Abra o <Link className="underline" href="/painel">Painel</Link>. O quadro <strong>“Para revisar”</strong> mostra quantos arquivos chegaram.</li>
          <li>Na tabela, clique no nome da empresa para abrir o pedido.</li>
          <li>Veja a quantidade de documentos e a validação (<strong>OK</strong> é o esperado). Se quiser conferir o conteúdo, clique em <strong>“Baixar ZIP”</strong>.</li>
          <li>Estando certo, clique em <strong>“Marcar como revisado”</strong>.</li>
        </Steps>
        <Note>Validação <strong>“QUARENTENA”</strong> ou <strong>“REJEITADO”</strong> significa que o arquivo veio estranho (por exemplo, sem nenhuma nota dentro). Não marque como revisado: avise o João.</Note>
      </Section>

      <Section id="arquivos" title="5. Onde ficam os arquivos">
        <p className="mt-3 text-sm leading-relaxed text-black/70">Cada ZIP é salvo no SharePoint, na pasta <code>Tecnologia\Leitor de XML - Zips</code>, assim: <code>CNPJ - Razão Social \ AAAA-MM \ CNPJ_TIPO_PAPEL_AAAA-MM.zip</code>. Por exemplo, a NFC-e de agosto da empresa 03948385000101 fica em <code>03948385000101 - TUPANZINHO HOMEOPATIA LTDA\2026-08\03948385000101_NFCE_EMITENTE_2026-08.zip</code>.</p>
        <p className="mt-2 text-sm leading-relaxed text-black/70">No menu <Link className="underline" href="/sharepoint">SharePoint</Link> você vê quantos arquivos já foram entregues, quantos faltam e os últimos entregues.</p>
      </Section>

      <Section id="problemas" title="6. Quando algo não vai bem">
        <div className="mt-3 overflow-x-auto rounded border border-black/10">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
                <th className="px-4 py-2">O que você vê</th>
                <th className="px-4 py-2">O que fazer</th>
              </tr>
            </thead>
            <tbody>
              {PROBLEMS.map(([sintoma, acao]) => (
                <tr key={sintoma} className="border-b border-black/5 align-top last:border-0">
                  <td className="px-4 py-3 font-medium text-black/80">{sintoma}</td>
                  <td className="px-4 py-3 text-black/70">{acao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Note tone="info">Ao pedir ajuda, mande sempre um <strong>print do popup da extensão</strong>. A linha “Último passo” mostra onde parou e resolve a maioria dos casos rápido.</Note>
      </Section>

      <Section id="regras" title="7. Regras de ouro">
        <ul className="mt-3 list-disc space-y-1.5 pl-6 text-sm leading-relaxed text-black/80">
          <li><strong>Não feche o Chrome</strong> nem a aba do Fisco Fácil enquanto houver trabalho (principalmente do dia 10 ao dia 17).</li>
          <li><strong>Não deixe o computador dormir.</strong></li>
          <li><strong>Não use a aba do Fisco Fácil</strong> enquanto o popup estiver azul e girando.</li>
          <li><strong>Nunca digite nem envie por mensagem</strong> a senha do certificado ou os códigos de acesso. Quem precisar deles, digita sozinho.</li>
          <li>Na dúvida, <strong>pare</strong> e chame o João. Parar é sempre seguro: o que faltou continua depois.</li>
        </ul>
      </Section>
    </Shell>
  );
}
