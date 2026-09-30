type Defaults = {
  cnpj?: string;
  razaoSocial?: string;
  inscricaoEstadual?: string | null;
  codigoDominio?: string | null;
  responsavel?: string | null;
  sharepointFolderPath?: string | null;
  situacaoCadastral?: string | null;
  certificadoTipo?: "ESCRITORIO_PROCURACAO" | "PROPRIO";
  procuracaoGrupo?: string | null;
  procuracaoPosicao?: number | null;
  ativo?: boolean;
};

const field = "rounded border border-black/15 px-3 py-2 text-sm outline-none focus:border-[#082240]";
const label = "text-sm font-medium text-black/80";

export function EstablishmentForm({ action, defaults, showAtivo }: { action: (formData: FormData) => void; defaults?: Defaults; showAtivo?: boolean }) {
  return (
    <form action={action} className="mt-6 flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="cnpj" className={label}>CNPJ (14 dígitos, só números)</label>
        <input id="cnpj" name="cnpj" required disabled={!!defaults} defaultValue={defaults?.cnpj} maxLength={14} className={`${field} disabled:bg-black/5`} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="razaoSocial" className={label}>Razão social</label>
        <input id="razaoSocial" name="razaoSocial" required defaultValue={defaults?.razaoSocial} className={field} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="inscricaoEstadual" className={label}>Inscrição estadual</label>
          <input id="inscricaoEstadual" name="inscricaoEstadual" defaultValue={defaults?.inscricaoEstadual ?? ""} className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="codigoDominio" className={label}>Código no Domínio</label>
          <input id="codigoDominio" name="codigoDominio" defaultValue={defaults?.codigoDominio ?? ""} className={field} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="responsavel" className={label}>Responsável</label>
        <input id="responsavel" name="responsavel" defaultValue={defaults?.responsavel ?? ""} className={field} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="sharepointFolderPath" className={label}>Pasta no SharePoint</label>
        <input id="sharepointFolderPath" name="sharepointFolderPath" placeholder="Documentos Fiscais/Fisco Fácil/CNPJ - Razão Social" defaultValue={defaults?.sharepointFolderPath ?? ""} className={field} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="situacaoCadastral" className={label}>Situação cadastral</label>
        <input id="situacaoCadastral" name="situacaoCadastral" placeholder="Habilitada, Baixada, ..." defaultValue={defaults?.situacaoCadastral ?? ""} className={field} />
        <p className="text-xs text-black/50">Empresas marcadas como &quot;Baixada&quot; ficam fora da rotina mensal automaticamente.</p>
      </div>
      <fieldset className="rounded border border-black/10 p-4">
        <legend className="px-1 text-sm font-medium text-black/80">Certificado</legend>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="certificadoTipo" value="PROPRIO" defaultChecked={defaults?.certificadoTipo !== "ESCRITORIO_PROCURACAO"} /> Certificado próprio da empresa
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="certificadoTipo" value="ESCRITORIO_PROCURACAO" defaultChecked={defaults?.certificadoTipo === "ESCRITORIO_PROCURACAO"} /> Procuração no certificado do escritório
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="procuracaoGrupo" className={label}>Grupo da procuração (opcional)</label>
            <input id="procuracaoGrupo" name="procuracaoGrupo" placeholder="ex.: SUBFIN" defaultValue={defaults?.procuracaoGrupo ?? ""} className={field} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="procuracaoPosicao" className={label}>Posição no índice (opcional)</label>
            <input id="procuracaoPosicao" name="procuracaoPosicao" type="number" min={1} defaultValue={defaults?.procuracaoPosicao ?? undefined} className={field} />
          </div>
        </div>
        <p className="mt-2 text-xs text-black/50">Deixe em branco se não souber — a extensão descobre sozinha na primeira coleta e guarda pra próxima vez.</p>
      </fieldset>
      {showAtivo && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ativo" defaultChecked={defaults?.ativo ?? true} /> Ativo na rotina mensal
        </label>
      )}
      <button type="submit" className="mt-2 w-fit rounded bg-[#082240] px-4 py-2 text-sm font-medium text-white hover:bg-[#123a5d]">Salvar</button>
    </form>
  );
}
