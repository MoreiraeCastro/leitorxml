# Leitor de XML (Fisco Fácil) — Handoff da Descoberta (Fase 1)

Data: 2026-09-28
Origem: sessão de planejamento + mapeamento manual ao vivo no Fisco Fácil (SEFAZ-RJ), feito por Paulo Roberto Silva Castro com certificado A1 real.
Documento base: `Escopo_Solucao_Fisco_Facil_Moreira_Castro_FORMATO_ORIGINAL.docx` (proposta original). Este handoff **substitui/atualiza** partes do escopo original conforme confirmado abaixo.

## 1. Escopo confirmado da v1 (atualizado)

- NF-e modelo 55: **Emitente e Destinatário** (o documento original previa só Emitente — isso mudou).
- NFC-e modelo 65: **Emitente apenas**.
- Ambiente de produção. Cadastro por estabelecimento (matriz e filiais separadas).
- Empresas com **Situação Cadastral "Baixada" ficam fora da rotina mensal** — só entram empresas com outras situações (ex.: "Habilitada").
- Fora do escopo v1 (mantido do documento original): apuração de tributos, emissão de notas, transmissão de declarações, cálculo automático de receita tributável, importação automática no Domínio.

## 2. Decisões de arquitetura

- **Sem AWS nova.** Orquestração de tarefas fica no Supabase/Postgres do próprio Portal Moreira, seguindo o mesmo padrão já usado para reconciliar notas `UNKNOWN` (`src/lib/nfse/reconciliation`, rota `src/app/api/internal/reconcile-pending/route.ts` varrida por cron externo). Não há fila real (SQS/BullMQ) hoje no projeto — o padrão é tabela de estado + varredura periódica.
- **SharePoint via Microsoft Graph** (app-only / client credentials). Patrick (usuário) tem acesso de admin M365 e vai provisionar o app registration no Azure AD e as permissões na biblioteca/site.
- **Distribuição da extensão Chrome**: ainda em aberto. Decidir ao final da Fase 2 (PoC), depois de validar o comportamento real do certificado A1 no navegador durante o piloto.
- **Certificados**: mistura dos dois casos — algumas empresas são acessadas via **procuração eletrônica** no certificado do escritório (Moreira & Castro), outras têm **certificado A1 próprio**. O cadastro de estabelecimento (Fase 4) precisa guardar qual dos dois se aplica a cada empresa, e o identificador da procuração/posição na lista quando for o caso.

## 3. Roteiro de extração mapeado (Fisco Fácil, SEFAZ-RJ)

### 3.1 Entrada

1. Autenticar no portal SEFAZ (`ssacert.fazenda.rj.gov.br/ssa/certificadoWeb`) com o certificado A1. Essa é a única etapa que dispara o **seletor nativo de certificado do navegador/SO** — não é algo que a extensão consiga clicar programaticamente.
2. Clicar no card **"AUTO Fisco Fácil"**.
3. Abre um modal **"Escolha um perfil abaixo"**, agrupado por um rótulo (ex.: "SUBFIN"), com uma lista de itens todos rotulados genericamente **"Acesso por procuração"** — o ícone de info ao lado **não revela qual empresa é** antes do clique. Só se descobre entrando.

### 3.2 Implicação de design: índice de procurações

Como a lista não identifica a empresa antecipadamente, a única forma de mapear "posição X da lista = empresa Y" é entrar e conferir o CNPJ na tabela seguinte. Isso é caro para fazer toda vez.

**Desenho proposto:** manter um índice cacheado (por certificado/grupo) mapeando posição da procuração → CNPJs contidos + Situação Cadastral de cada um. Nas coletas mensais seguintes, o conector vai direto na posição já mapeada. Se o CNPJ esperado não aparecer mais ali, cai em fallback de reindexação completa daquele grupo.

### 3.3 Dentro de uma procuração: lista de empresas

- Ao entrar numa procuração, cai numa tabela com colunas: Notificação e/ou Intimação, CPF/CNPJ, Inscrição Estadual, Nome/Razão, Pendências, Valor (R$), Situação Cadastral.
- Essa tabela **pagina** (visto "1 de 2", mas pode chegar a ~10 páginas). É preciso percorrer **todas as páginas** antes de considerar a procuração concluída.
- **Pular** qualquer linha com Situação Cadastral = "Baixada" (não entra na rotina).
- Checar pendências/notificações aqui é **só navegação** — não faz parte do que estamos automatizando (não é escopo de negócio, é station de passagem).

### 3.4 Por empresa: extração de documentos fiscais

Estando com a empresa selecionada (nome/CNPJ/IE aparecem no topo da tela do Sistema Fisco Fácil):

1. Menu lateral → **"Extração de documentos fiscais"**.
2. Preencher o formulário e **submeter 3 vezes** (uma combinação por vez, com "Voltar" entre cada):
   - Período: sempre **Meses**, sempre o **mês anterior completo** (dia 01 ao último dia do mês corrente-1).
   - Combinação 1: **NF-e + Destinatário** → Confirmar solicitação.
   - Combinação 2: **NF-e + Emitente** → Confirmar solicitação.
   - Combinação 3: **NFC-e + Emitente** → Confirmar solicitação.
3. Aba **"Solicitações"**: conferir cada uma das 3 pelo **Tipo / Data / Referência** (a Referência do pedido é a chave para reencontrar depois — ver §4).
4. Terminadas as 3 combinações, clicar em **"Selecionar estabelecimento"** → escolher a próxima empresa da lista (mesma procuração, respeitando a paginação) → repetir a partir do passo 1.
5. Só depois de esgotar **todas** as páginas de empresas daquela procuração: usar a **seta de voltar do navegador** (não navegação direta) até a página inicial da SEFAZ, abrir "AUTO Fisco Fácil" de novo, entrar na próxima procuração.

### 3.5 Por que "seta de voltar" importa

- Trocar de empresa **dentro** da mesma procuração via "Selecionar estabelecimento" é puramente em página — não reautentica.
- Trocar de **procuração** usando a seta de voltar do navegador também preserva a sessão — não pede certificado de novo.
- Navegar de outra forma (ex.: abrir link direto, não usar o histórico do navegador) parece forçar uma troca de "perfil" que pede o certificado de novo. **A extensão deve preferir sempre navegação por histórico (voltar), nunca abrir URLs novas "a frio", para evitar reautenticações desnecessárias.**
- O seletor nativo de certificado do SO/navegador só deveria aparecer **uma vez por sessão** (login inicial). Reconfirmar esse comportamento durante a PoC (Fase 2) — inclusive o que acontece se a sessão expirar no meio do lote.

## 4. Estados, tempos e comportamentos observados

- Status possíveis na aba Solicitações: **"Processado com resultado"** (pronto pra baixar), **"Processado sem resultado"** (nada a extrair para aquele período/tipo), **"Aguardando processamento"**, **"Expirada"** (teve resultado, mas passou tempo demais / já foi baixado antes).
- **"Expirada" confirma resumability**: dá pra sair, fechar tudo, voltar depois, reencontrar o pedido pela **Referência** salva e ver o status atualizado — não é preciso criar mecanismo próprio de dedup além de guardar a Referência retornada por cada solicitação.
- **Download vem em 1 único ZIP** por solicitação processada — nunca houve fragmentação em múltiplas partes até hoje, mesmo em competências de maior volume (ver §6).
- **Tempo de processamento**: a SEFAZ costuma indicar uma previsão de conclusão bem conservadora (ex.: pedido feito em setembro com previsão de conclusão só em outubro) — **isso não é um sinal operacional confiável**. Na prática, regra observada: aguardar até **24h**; se não resolver, registrar aviso de "não foi possível continuar automaticamente" e reagendar checagem manual/automática depois de 24h.
- **Dia 10 do mês é o gargalo**: só dá para ver o mês anterior fechado a partir do dia 10, e nesse dia o site fica **muito lento** (todo mundo acessando ao mesmo tempo). Isso deve ser considerado no dimensionamento de retries e nos avisos de atraso (não tratar lentidão do dia 10 como falha, e sim como esperado).

## 5. Agenda de execução proposta

- **Disparo mensal**: dia 10 do mês corrente, criando as tarefas para o mês anterior fechado.
- **Sweep de acompanhamento**: reconsultar status pendentes a cada **3 dias** após o disparo (mesmo padrão do cron do `reconcile-pending`), até tudo virar resultado final (processado com/sem resultado, expirado, ou sinalizado para checagem manual após 24h sem avanço).
- Datas e intervalo devem ser parâmetros configuráveis (não hardcoded), como já sugeria o documento original.

## 6. Confirmado após a Descoberta

- **Volume alto**: até hoje nunca houve volume que fragmentasse o ZIP em mais de uma parte — considerar ZIP único como regra prática (sem lógica de múltiplas partes na v1), mas manter o campo pronto para o caso raro de mudar.
- **Expiração de sessão em lote longo**: não é esperado que ocorra, mas se ocorrer, a recuperação é simples — reautenticar com o certificado do escritório (que ficará instalado nas máquinas usadas) e continuar de onde parou. Não é um cenário que precisa de tratamento especial além de deixar a extensão apta a reautenticar e retomar.
- **Regra operacional para identificar o que falta processar ("throughput")**: ao reentrar numa empresa/procuração, a varredura de trabalho pendente é: olhar todas as solicitações com status diferente de "baixada" cuja referência de competência seja o mês anterior ao mês vigente. Isso substitui qualquer necessidade de estimar capacidade por certificado — o critério de seleção de trabalho é sempre por competência + status, não por contagem de empresas cobertas.

## 7. Em aberto — testar na Fase 2 (PoC)

- **Comportamento exato do dia 10** sob carga real (tempos de resposta, taxa de erro) — único item que ainda depende de observação ao vivo.

## 8. Pesquisa: API oficial do Fisco Fácil

Não existe uma API pública do Fisco Fácil para extração em lote de DF-e — é um portal web. Alternativas mapeadas:

- **"Conformidade Fácil" API**: não serve para isso — é uma API de consulta a regras de validação/malha fiscal, não de download de documentos.
- **APIs pagas de terceiros** (Infosimples, Webmania, [FiscalAPI](https://fiscalapi.com.br/blog/api-baixar-xml-nfe-chave-de-acesso/) e similares): tecnicamente funcionam, mas exigem enviar o certificado A1 (.pfx) para o servidor deles — a FiscalAPI, por exemplo, chama isso de política "zero custody" (usa e descarta na hora), mas é uma promessa não auditável, e contraria a premissa de segurança do projeto (certificado nunca sai da máquina do usuário). Além disso, a FiscalAPI só cobre NF-e (não NFC-e) e exige já saber a chave de acesso de antemão — não resolve o problema de **descobrir** quais notas existem num período, que é o ponto central da extração em lote. Não recomendado.
- **NFeDistribuicaoDFe (webservice nacional, ambiente SVRS) — spike concluído em 2026-09-28**, lendo a Nota Técnica 2014.002 v1.02d (documento oficial Receita Federal/ENCAT). Conclusão: **não vale a pena para a v1**. Três motivos:
  1. **Não cobre NFC-e.** A validação de chave de acesso rejeita explicitamente "modelo diferente de 55" (erro 618); o documento inteiro só trata NF-e. NFC-e modelo 65 continua 100% dependente do Fisco Fácil.
  2. **O emitente não recebe a própria NF-e por esse serviço** — regra explícita: "A NF-e não deve ser disponibilizada para o emitente da NF-e" (erro 641/H17). O serviço entrega documentos de **terceiros** de interesse do consultante, não os que ele mesmo emitiu. Não ajuda na perna "NF-e como Emitente".
  3. **NF-e como Destinatário exige manifestação prévia.** Antes de manifestar (Ciência da Operação / Confirmação de Operação / Operação não Realizada), só vem o resumo da NF-e, não o XML completo. Automatizar isso implicaria também automatizar a Manifestação do Destinatário — um ato fiscal formal com peso jurídico próprio, não um detalhe técnico. É escopo de negócio novo, não uma melhoria incremental do que já temos.
  - Detalhes técnicos adicionais que reforçam isso: o modelo é de sincronização **incremental por NSU** (um cursor contínuo — não dá pra pedir "tudo de agosto" diretamente), limite de 50 documentos por chamada, e bloqueio de 1h se consultar de novo sem ter documentos novos (erro 656) — desenhado para polling contínuo, não para pedido pontual por competência. Além disso, pra não violar a regra de "certificado nunca sai da máquina do usuário", a chamada teria que ser feita a partir da própria máquina (pela extensão, via TLS com certificado do cliente), nunca do backend no Supabase.
  - Fonte: [Nota Técnica 2014.002 v1.02d — NFeDistribuicaoDFe](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=wLVBlKchUb4%3D) (Receita Federal/ENCAT).

**Recomendação**: descartar para a v1. A automação via navegador (Fisco Fácil) já cobre 100% do escopo v1 (NF-e emitente e destinatário, NFC-e emitente) e está totalmente mapeada. Reavaliar o `NFeDistribuicaoDFe` só se, por outro motivo de negócio, a Direção decidir automatizar Manifestação do Destinatário — aí sim essa API passa a fazer sentido como parte de um projeto separado.

## 9. Próximos passos técnicos

1. Fechar decisões da Fase 0 (nome do site/biblioteca do SharePoint no Graph; mapeamento de roles).
2. Rodar a PoC (Fase 2) na empresa/certificado já escolhidos, cobrindo o item do §7 (comportamento do dia 10 sob carga real).
3. ~~Desenhar o schema da tabela de tarefas e o índice de procurações~~ — feito em `leitorxml_design_tecnico.md`.
4. ~~Especificar o contrato do conector (extensão ↔ portal)~~ — feito em `leitorxml_design_tecnico.md`.
5. ~~Rodar o spike de API~~ — concluído (§8): descartado para a v1.
