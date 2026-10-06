# Robô do Leitor de XML (Fase 1: conferir e baixar)

> **EXPERIMENTAL — DESLIGADO.** Não está instalado nem agendado no servidor (os arquivos em `deploy/leitorxml-robo.*`
> existem mas NÃO foram ativados). Em 2026-10-06 os testes mostraram que o Fisco Fácil **limita acesso automatizado**:
> com Chrome sem tela bloqueia de cara; com Chrome visível entra e lê a aba Solicitações, mas depois de poucas empresas
> o site para de responder (procuração sem resposta, clique na empresa sem navegar, página inicial sem o card) ou mostra
> a página de bloqueio. O mesmo PC/certificado/IP funcionam normalmente no Chrome de uma pessoa. **Não contornar essa
> barreira** (sem disfarçar o navegador): o caminho é a extensão no Chrome de um usuário real, ou acordar acesso
> automatizado com a SEFAZ-RJ. Este código fica como base caso isso mude.
>
> O que já foi validado ao vivo: login com A1 (inclusive a partir do IP da AWS, em tela virtual), entrada por
> procuração, busca da empresa, leitura/classificação da aba Solicitações e abertura da página de detalhe "Processada".
> Não foi validado: o download do ZIP até o fim (travou antes por causa do bloqueio).

Faz sozinho, com o **certificado A1**, o que o botão "Conferir e baixar" da extensão faz: entra no Fisco Fácil por
procuração, abre a aba **Solicitações** de cada empresa com pendência, atualiza a situação e baixa os ZIPs
"Processada" (página de detalhe), enviando-os ao portal. **Só lê e baixa — nunca cria solicitação.**

Usa as mesmas rotas de API da extensão (`/api/leitorxml/extensao/*`), com o próprio token. A extensão continua
funcionando como reserva.

## Por que um Chrome "de verdade"
O Fisco Fácil mostra uma página de bloqueio pra Chrome **sem tela** (testado em 2026-10-06). Com o Chrome visível, ou
numa tela virtual (`xvfb-run`), entra normalmente — inclusive a partir do IP da AWS.

## Segredos (nunca no repositório)
| Segredo | Em produção | Teste manual |
|---|---|---|
| Senha do A1 | credencial **criptografada** `/etc/leitorxml-robo/a1pass.cred` (`systemd-creds`) | digitada escondida no terminal, ou `ROBO_A1PASS_FILE` |
| Token da API | `/etc/leitorxml-robo/robo-token.cred` | digitado escondido, ou `ROBO_TOKEN_FILE` |
| Certificado `.pfx` | `/home/ubuntu/leitorxml-robo/segredos/certificado.pfx` (modo 600) | `ROBO_PFX=caminho` |

Criar as credenciais criptografadas (a senha é digitada no SEU terminal e nunca aparece):

```bash
sudo mkdir -p /etc/leitorxml-robo
read -rs -p "Senha do A1: " P; echo; printf %s "$P" | sudo systemd-creds encrypt --name=a1pass - /etc/leitorxml-robo/a1pass.cred; unset P
read -rs -p "Token do robô: " T; echo; printf %s "$T" | sudo systemd-creds encrypt --name=robo-token - /etc/leitorxml-robo/robo-token.cred; unset T
sudo chmod 600 /etc/leitorxml-robo/*.cred
```

## Rodar
- Teste local (abre o Chrome na sua tela): `ROBO_PFX="C:\caminho\certificado.pfx" npm run robo:rastrear -- --max-empresas 1`
- Servidor: `sudo systemctl start leitorxml-robo.service` e `journalctl -u leitorxml-robo.service -f`.
- Agendado: `leitorxml-robo.timer` (todo dia 01:30, horário de Brasília).

## Limites de segurança
Pára sozinho se: 3 empresas seguidas falharem, a SEFAZ mostrar a página de bloqueio, passar de 180 min ou 200 empresas.
No servidor, o serviço tem teto de memória e prioridade baixa: se faltar RAM, morre o robô, não o portal.

## Renovação do certificado
O A1 vence em **01/12/2026**. Trocar o `.pfx` em `segredos/` e recriar a credencial `a1pass` se a senha mudar.
