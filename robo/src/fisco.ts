import { readFile } from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { RawSolicitacaoRow } from "./solicitacoes.ts";

export const HOME_URL = "https://ssacert.fazenda.rj.gov.br/ssa/certificadoWeb";
const ORIGINS = ["https://ssacert.fazenda.rj.gov.br", "https://fisco-facil.fazenda.rj.gov.br"];
const SOLICITACOES_TABLE_ID = "frmHistInteracoes:tabsHist:solicitacao";
const LINKS_PROCURACAO = "#conteudoModalAutorizacoes span[onclick*='chamaAplicacao']";

export type ProcuracaoLink = { grupo: string | null; posicao: number; nth: number };

/**
 * Uma sessão do Fisco Fácil dirigida por um Chrome REAL (não headless: o site reconhece e bloqueia o modo sem tela,
 * confirmado em 2026-10-06). No servidor roda dentro de uma tela virtual (xvfb-run). O login é o certificado A1,
 * apresentado na conexão TLS — não há senha de site. Portada de extension/src/content-*.js; os cliques aqui são
 * entrada de verdade do navegador, então os contornos de "clique real via CDP" da extensão não são necessários.
 */
export class FiscoSession {
  readonly browser: Browser;
  readonly context: BrowserContext;
  page: Page;
  private readonly log: (message: string) => void;

  private constructor(browser: Browser, context: BrowserContext, page: Page, log: (message: string) => void) {
    this.browser = browser;
    this.context = context;
    this.page = page;
    this.log = log;
  }

  static async open(options: { pfxPath: string; passphrase: string; log: (message: string) => void }) {
    const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--disable-dev-shm-usage"] });
    try {
      const context = await browser.newContext({
        clientCertificates: ORIGINS.map((origin) => ({ origin, pfxPath: options.pfxPath, passphrase: options.passphrase })),
        viewport: { width: 1366, height: 900 },
        acceptDownloads: true,
      });
      // O próprio site referencia uma global `options` que não define: sem isso o showLoading() dá TypeError.
      // String vazia, não objeto (confirmado ao vivo, 2026-10-02).
      await context.addInitScript(() => {
        (window as unknown as { options?: unknown }).options ??= "";
      });
      context.setDefaultTimeout(30000);
      const page = await context.newPage();
      return new FiscoSession(browser, context, page, options.log);
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
  }

  async close() {
    await this.browser.close().catch(() => {});
  }

  // ---------- utilidades ----------

  /** Espera o overlay #loading sumir (há DOIS elementos com esse id: template escondido + clone visível) e a rede aquietar. */
  async waitIdle(label: string, timeoutMs = 25000) {
    await this.page.waitForTimeout(400); // dá tempo do overlay aparecer depois do clique
    const gone = () => {
      const visible = (el: Element) => {
        const style = getComputedStyle(el);
        const box = el as HTMLElement;
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && box.offsetWidth > 0 && box.offsetHeight > 0;
      };
      return ![...document.querySelectorAll('[id="loading"]')].some(visible);
    };
    try {
      await this.page.waitForFunction(gone, undefined, { timeout: timeoutMs });
    } catch {
      this.log(`overlay preso depois de "${label}": escondendo à força`);
      await this.page.evaluate(() => {
        try {
          (window as unknown as { hideLoading?: () => void }).hideLoading?.();
        } catch {
          // o próprio hideLoading do site pode falhar; o display:none abaixo resolve
        }
        document.querySelectorAll('[id="loading"]').forEach((el) => ((el as HTMLElement).style.display = "none"));
      });
    }
    await this.page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  }

  /** Página de bloqueio de segurança da SEFAZ (acontece com navegador sem tela / IP reputado): falha alto, com a causa. */
  private async assertNotBlocked() {
    const text = await this.page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (/mensagem de bloqueio|endereços IP usados por serviços residenciais/i.test(text)) throw new Error("BLOQUEADO_PELA_SEFAZ: página de bloqueio de segurança no lugar do Fisco Fácil");
  }

  // ---------- portal: card AUTO Fisco Fácil → procuração ----------

  async goHome() {
    await this.page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await this.page.locator("h5", { hasText: "AUTO Fisco Fácil" }).first().waitFor({ state: "visible", timeout: 45000 });
  }

  /** Abre o modal "Escolha um perfil" e devolve as procurações (grupo + posição) já carregadas por AJAX. */
  async listProcuracoes(): Promise<ProcuracaoLink[]> {
    await this.page.locator("a.card", { has: this.page.locator("h5", { hasText: "AUTO Fisco Fácil" }) }).first().click();
    await this.page.locator("#modalAutorizacoes.show").waitFor({ state: "visible", timeout: 20000 });
    await this.page.locator(LINKS_PROCURACAO).first().waitFor({ state: "attached", timeout: 60000 });
    return this.page.evaluate(() => {
      const items: { grupo: string | null; posicao: number; nth: number }[] = [];
      let grupo: string | null = null;
      let nth = 0;
      const perfil = /chamaAplicacao\(\s*'[^']*'\s*,\s*\d+\s*,\s*(\d+)\s*,/;
      for (const el of document.querySelectorAll("#conteudoModalAutorizacoes h6.fw-bold, #conteudoModalAutorizacoes span[onclick*='chamaAplicacao']")) {
        if (el.matches("h6.fw-bold")) {
          grupo = el.textContent?.trim() ?? null;
          continue;
        }
        const match = perfil.exec(el.getAttribute("onclick") ?? "");
        if (match) items.push({ grupo, posicao: Number(match[1]), nth });
        nth += 1;
      }
      return items;
    });
  }

  /** Clica na procuração e espera cair na lista de empresas do Fisco Fácil. */
  async enterProcuracao(link: ProcuracaoLink) {
    await this.page.locator(LINKS_PROCURACAO).nth(link.nth).click();
    await this.page.waitForURL(/fisco-facil\.fazenda\.rj\.gov\.br/, { timeout: 60000 });
    await this.page.waitForLoadState("domcontentloaded");
    await this.assertNotBlocked();
    await this.page.locator('[id="FrmFisco:ListaContribuintes_data"]').waitFor({ state: "attached", timeout: 45000 });
  }

  // ---------- lista de empresas ----------

  private async firstRowCnpj() {
    return this.page.evaluate(() => {
      const body = document.getElementById("FrmFisco:ListaContribuintes_data");
      if (body?.querySelector(".ui-datatable-empty-message")) return { empty: true as const, cnpj: null };
      const row = body?.querySelector("tr");
      return { empty: false as const, cnpj: row?.querySelectorAll("td")[1]?.textContent?.trim().replace(/\D/g, "") ?? null };
    });
  }

  /** Busca o CNPJ e entra na empresa. Devolve false se a procuração atual não tem essa empresa. */
  async openCompany(cnpj: string): Promise<boolean> {
    const input = this.page.locator('[id="FrmFisco:valorDaPesquisa_input"], [id="FrmFisco:valorDaPesquisa"]').first();
    for (let attempt = 1; attempt <= 2; attempt++) {
      await input.click();
      await this.page.keyboard.press("Control+A");
      await this.page.keyboard.press("Delete");
      // Campo com máscara: insere o texto de uma vez (mesmo que o Input.insertText da extensão). Tecla por tecla a
      // máscara engole o zero à esquerda (CNPJ 00943302000101 virou 09433020001010, visto ao vivo em 2026-10-06).
      await this.page.keyboard.insertText(cnpj);
      const typed = (await input.inputValue()).replace(/\D/g, "");
      if (typed !== cnpj) {
        this.log(`campo de busca ficou com "${typed}" (esperava ${cnpj}), tentativa ${attempt}`);
        continue;
      }
      await this.page.getByRole("button", { name: /Filtrar/ }).first().click();
      await this.waitIdle("busca por CNPJ");
      const found = await this.firstRowCnpj();
      if (found.empty) return false;
      if (found.cnpj !== cnpj) {
        this.log(`busca devolveu ${found.cnpj} no lugar de ${cnpj}, tentativa ${attempt}`);
        continue;
      }
      await this.page.waitForTimeout(800); // o PrimeFaces religa a seleção de linha um instante depois do overlay sumir
      const rowCell = this.page.locator('[id="FrmFisco:ListaContribuintes_data"] tr').first().locator("td").first();
      for (let click = 1; click <= 2; click++) {
        await rowCell.click();
        // O 1º clique às vezes não navega (site lento, visto na extensão): um 2º resolve a maioria.
        const entered = await this.page.waitForURL(/mainAbasContribuinte/, { timeout: click === 1 ? 15000 : 30000 }).then(() => true, () => false);
        if (entered) {
          await this.page.waitForLoadState("domcontentloaded");
          return true;
        }
        this.log(`clique na linha da empresa não navegou (tentativa ${click})`);
        await this.assertNotBlocked();
      }
      throw new Error(`NAO_ENTROU_NA_EMPRESA: clicar na linha de ${cnpj} não abriu o painel da empresa`);
    }
    throw new Error(`BUSCA_NAO_FILTROU: não consegui filtrar ${cnpj} na lista de empresas`);
  }

  // ---------- painel da empresa: aba Solicitações ----------

  async openSolicitacoes() {
    await this.page.locator('a:text-is("Solicitações")').first().click();
    await this.waitIdle("aba Solicitações");
    await this.page.locator(`[id="${SOLICITACOES_TABLE_ID}_data"]`).waitFor({ state: "attached", timeout: 20000 });
  }

  async readSolicitacoes(): Promise<RawSolicitacaoRow[]> {
    return this.page.evaluate((tableId) => {
      const body = document.getElementById(`${tableId}_data`);
      return [...(body?.querySelectorAll("tr[data-ri]") ?? [])].map((tr, index) => {
        const cells = [...tr.querySelectorAll("td")];
        const link = cells[3]?.querySelector("a") ?? [...tr.querySelectorAll("a")].find((a) => /process|aguard|expirad/i.test(a.textContent ?? ""));
        return {
          index,
          referencia: cells[2]?.textContent ?? tr.textContent ?? "",
          quandoTexto: cells[1]?.textContent ?? "",
          situacaoTexto: link?.textContent ?? cells[3]?.textContent ?? "",
          temLink: Boolean(link),
        };
      });
    }, SOLICITACOES_TABLE_ID);
  }

  /** Vai pra próxima página da tabela de solicitações; false se já é a última. */
  async nextSolicitacoesPage() {
    const next = this.page.locator(`[id="${SOLICITACOES_TABLE_ID}"] .ui-paginator-next`).first();
    if (!(await next.count()) || (await next.getAttribute("class"))?.includes("ui-state-disabled")) return false;
    await next.click();
    await this.waitIdle("próxima página de Solicitações");
    return true;
  }

  // ---------- página de detalhe da solicitação: download ----------

  /** Clica na situação "Processada" da linha e espera a página de detalhe (tabela de arquivos). */
  async openDetail(rowIndex: number) {
    const rows = this.page.locator(`[id="${SOLICITACOES_TABLE_ID}_data"] tr[data-ri]`);
    const link = rows.nth(rowIndex).locator("td").nth(3).locator("a").first();
    await link.click();
    await this.page.waitForFunction(
      () => [...document.querySelectorAll("table")].some((table) => /Arquivo/i.test(table.textContent ?? "") && /Expira em/i.test(table.textContent ?? "") && table.querySelector("tbody tr td")),
      undefined,
      { timeout: 45000 },
    );
  }

  /** Baixa cada arquivo da página de detalhe e devolve os bytes. O download do Fisco Fácil sai de um clique de formulário. */
  async downloadFiles(): Promise<{ name: string; bytes: Uint8Array }[]> {
    // Mesma leitura da extensão (findFilesTable em content-fisco.js): acha a tabela de arquivos e marca cada linha
    // com um atributo, pra clicar nela depois. Espera até 10 s as linhas aparecerem (a tabela chega por AJAX).
    const readFilesTable = () =>
      this.page.evaluate(() => {
        const table = [...document.querySelectorAll("table")].find((t) => /Arquivo/i.test(t.textContent ?? "") && /Expira em/i.test(t.textContent ?? "") && t.querySelector("tbody tr td"));
        const rows = [...(table?.querySelectorAll("tbody tr") ?? [])].filter((row) => row.querySelector("td"));
        rows.forEach((row, index) => row.setAttribute("data-robo-arquivo", String(index)));
        return {
          tabelas: document.querySelectorAll("table").length,
          achouTabela: Boolean(table),
          linhas: rows.map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 100)),
          trecho: (document.body.innerText ?? "").replace(/\s+/g, " ").slice(0, 200),
        };
      });
    let found = await readFilesTable();
    for (let attempt = 0; attempt < 10 && !found.linhas.length; attempt++) {
      await this.page.waitForTimeout(1000);
      found = await readFilesTable();
    }
    const count = found.linhas.length;
    if (!count) throw new Error(`Nenhum arquivo listado na página da solicitação (tabelas na página: ${found.tabelas}; achou a tabela de arquivos: ${found.achouTabela}; tela: "${found.trecho}")`);
    this.log(`página da solicitação: ${count} arquivo(s): ${found.linhas.join(" | ")}`);
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (let i = 0; i < count; i++) {
      const button = this.page.locator(`[data-robo-arquivo="${i}"]`).locator("td a, td button, td [role='button']").first();
      if (!(await button.count())) throw new Error(`linha ${i + 1} sem botão de download`);
      const [download] = await Promise.all([this.page.waitForEvent("download", { timeout: 90000 }), button.click()]);
      const path = await download.path();
      files.push({ name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(path)) });
    }
    return files;
  }

  /** Volta da página de detalhe pro painel da empresa (recarrega de verdade, sem bfcache). */
  async backToCompany() {
    await this.page.goBack({ waitUntil: "domcontentloaded", timeout: 45000 });
    await this.page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
    await this.page.waitForURL(/mainAbasContribuinte|principalContribuintes/, { timeout: 30000 });
  }
}
