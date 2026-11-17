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

const field = "input";
const label = "label";

export function EstablishmentForm({ action, defaults, showAtivo }: { action: (formData: FormData) => void; defaults?: Defaults; showAtivo?: boolean }) {
  return (
    <form action={action} className="card card-pad flex max-w-2xl flex-col gap-7">
      <fieldset className="form-section">
        <legend className="section-title">Empresa</legend>
        <div className="field">
          <label htmlFor="cnpj" className={label}>CNPJ (14 dígitos, só números)</label>
          <input id="cnpj" name="cnpj" required disabled={!!defaults} defaultValue={defaults?.cnpj} maxLength={14} className={`${field} tabular`} />
        </div>
        <div className="field">
          <label htmlFor="razaoSocial" className={label}>Razão social</label>
          <input id="razaoSocial" name="razaoSocial" required defaultValue={defaults?.razaoSocial} className={field} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="field">
            <label htmlFor="inscricaoEstadual" className={label}>Inscrição estadual</label>
            <input id="inscricaoEstadual" name="inscricaoEstadual" defaultValue={defaults?.inscricaoEstadual ?? ""} className={`${field} tabular`} />
          </div>
          <div className="field">
            <label htmlFor="codigoDominio" className={label}>Código no Domínio</label>
            <input id="codigoDominio" name="codigoDominio" defaultValue={defaults?.codigoDominio ?? ""} className={`${field} tabular`} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="responsavel" className={label}>Responsável</label>
          <input id="responsavel" name="responsavel" defaultValue={defaults?.responsavel ?? ""} className={field} />
        </div>
        <div className="field">
          <label htmlFor="sharepointFolderPath" className={label}>Pasta no SharePoint</label>
          <input id="sharepointFolderPath" name="sharepointFolderPath" placeholder="Documentos Fiscais/Fisco Fácil/CNPJ - Razão Social" defaultValue={defaults?.sharepointFolderPath ?? ""} className={field} />
        </div>
        <div className="field">
          <label htmlFor="situacaoCadastral" className={label}>Situação cadastral</label>
          <input id="situacaoCadastral" name="situacaoCadastral" placeholder="Habilitada, Baixada, ..." defaultValue={defaults?.situacaoCadastral ?? ""} className={field} />
          <p className="help">Empresas marcadas como &quot;Baixada&quot; ficam fora da rotina mensal automaticamente.</p>
        </div>
      </fieldset>
      <fieldset className="form-section border-t border-[var(--line)] pt-6">
        <legend className="section-title">Certificado</legend>
        <div className="flex flex-col gap-2">
          <label className="check">
            <input type="radio" name="certificadoTipo" value="PROPRIO" defaultChecked={defaults?.certificadoTipo !== "ESCRITORIO_PROCURACAO"} /> Certificado próprio da empresa
          </label>
          <label className="check">
            <input type="radio" name="certificadoTipo" value="ESCRITORIO_PROCURACAO" defaultChecked={defaults?.certificadoTipo === "ESCRITORIO_PROCURACAO"} /> Procuração no certificado do escritório
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="field">
            <label htmlFor="procuracaoGrupo" className={label}>Grupo da procuração (opcional)</label>
            <input id="procuracaoGrupo" name="procuracaoGrupo" placeholder="ex.: SUBFIN" defaultValue={defaults?.procuracaoGrupo ?? ""} className={field} />
          </div>
          <div className="field">
            <label htmlFor="procuracaoPosicao" className={label}>Posição no índice (opcional)</label>
            <input id="procuracaoPosicao" name="procuracaoPosicao" type="number" min={1} defaultValue={defaults?.procuracaoPosicao ?? undefined} className={`${field} tabular`} />
          </div>
        </div>
        <p className="help -mt-1">Deixe em branco se não souber — a extensão descobre sozinha na primeira coleta e guarda pra próxima vez.</p>
      </fieldset>
      {showAtivo && (
        <label className="check border-t border-[var(--line)] pt-6">
          <input type="checkbox" name="ativo" defaultChecked={defaults?.ativo ?? true} /> Ativo na rotina mensal
        </label>
      )}
      <div className="flex justify-end border-t border-[var(--line)] pt-5">
        <button type="submit" className="btn">Salvar</button>
      </div>
    </form>
  );
}
