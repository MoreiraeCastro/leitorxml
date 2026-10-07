import { requireOfficeSessionOrRedirect } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell } from "@/components/shell";
import { previousClosedCompetencia } from "@/lib/leitorxml/tasks";
import { dispararExtracao } from "../actions";

export const metadata = { title: "Nova extração" };

export default async function NovaExtracaoPage() {
  const session = await requireOfficeSessionOrRedirect();
  const { data: establishments, error } = await createAdminClient()
    .from("xml_watch_establishments")
    .select("id,cnpj,razao_social,situacao_cadastral,ativo")
    .order("razao_social");
  const fallback = previousClosedCompetencia();

  return (
    <Shell session={session}>
      <h1 className="text-lg font-semibold text-[#082240]">Nova extração</h1>
      <p className="mt-1 text-sm text-black/60">Escolha as empresas e o mês. Cada uma ganha as 3 tarefas. Inativas e baixadas são ignoradas.</p>

      {error && <p className="mt-4 text-sm text-red-700">Não foi possível carregar os estabelecimentos.</p>}

      {!error && (
        <form action={dispararExtracao} className="mt-6 flex flex-col gap-6">
          <div className="flex items-end gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="competenciaAno" className="text-sm font-medium text-black/80">Ano</label>
              <input id="competenciaAno" name="competenciaAno" type="number" required defaultValue={fallback.competenciaAno} className="w-24 rounded border border-black/15 px-3 py-2 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="competenciaMes" className="text-sm font-medium text-black/80">Mês</label>
              <input id="competenciaMes" name="competenciaMes" type="number" min={1} max={12} required defaultValue={fallback.competenciaMes} className="w-20 rounded border border-black/15 px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="rounded border border-black/10 bg-white">
            <div className="border-b border-black/10 bg-black/[0.03] px-4 py-2 text-xs uppercase tracking-wide text-black/50">Estabelecimentos</div>
            <div className="max-h-96 divide-y divide-black/5 overflow-y-auto">
              {(establishments ?? []).map((establishment) => {
                const excluded = !establishment.ativo || establishment.situacao_cadastral === "Baixada";
                return (
                  <label key={establishment.id} className={`flex items-center gap-3 px-4 py-2 text-sm ${excluded ? "text-black/30" : ""}`}>
                    <input type="checkbox" name="establishmentIds" value={establishment.id} disabled={excluded} defaultChecked={!excluded} />
                    <span className="flex-1">{establishment.razao_social} <span className="text-black/50">— {establishment.cnpj}</span></span>
                    {excluded && <span className="text-xs">{establishment.situacao_cadastral === "Baixada" ? "Baixada" : "Inativo"}</span>}
                  </label>
                );
              })}
              {!establishments?.length && <p className="px-4 py-6 text-sm text-black/50">Nenhum estabelecimento cadastrado — cadastre um primeiro.</p>}
            </div>
          </div>

          <button type="submit" className="w-fit rounded bg-[#082240] px-4 py-2 text-sm font-medium text-white hover:bg-[#123a5d]">Criar tarefas</button>
        </form>
      )}
    </Shell>
  );
}
