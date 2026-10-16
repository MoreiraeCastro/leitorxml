/**
 * Instalador de 1 clique: um .bat que carrega, embutido, o ZIP da extensão. Ao abrir, extrai em C:\LeitorXML,
 * copia o caminho, abre o chrome://extensions e mostra os 3 cliques que o Chrome não deixa automatizar
 * (extensões fora da loja exigem o "Modo do desenvolvedor").
 *
 * Também instala o ATUALIZADOR (a partir de 0.1.5): um script ao lado da pasta, registrado no Chrome como "host de
 * mensagens nativas" só para esta extensão. A extensão o chama (botão "Atualizar extensão" ou sozinha, quando o portal
 * tem versão nova) e ele baixa o pacote, CONFERE A ASSINATURA e troca a pasta. Sem administrador: tudo no usuário.
 *
 * Variáveis para teste (não usadas no dia a dia): LEITORXML_DEST troca a raiz C:\ e LEITORXML_QUIET pula Chrome e janelas.
 */
const MARKER = "#PS#";

/** Endereço do portal que o atualizador consulta. */
export const DEFAULT_UPDATE_BASE_URL = "https://portalmoreiraecastro.com.br/leitorxml";

/** Nome do host de mensagens nativas (tem que bater com NATIVE_UPDATER em extension/src/background.js). */
export const NATIVE_HOST_NAME = "br.com.moreiraecastro.leitorxml";

/**
 * Chave do registro que o Chrome lê para achar o atualizador. Montada AQUI, fora do String.raw do script: lá dentro,
 * uma barra invertida logo antes de "${" impede a interpolação, e o instalador gravava a chave com o nome literal
 * "${NATIVE_HOST_NAME}" — o Chrome respondia "native messaging host not found". Era esse o "arquivos gravados, chave
 * ausente" de 14/10/2026: a conferência passava porque lia o mesmo caminho errado. (Achado no DET em 16/10/2026.)
 */
export const CHAVE_REGISTRO = "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\" + NATIVE_HOST_NAME;

/** A chave com o nome errado que o instalador com defeito deixou nos PCs; o instalador novo a apaga. */
const CHAVE_REGISTRO_ERRADA = "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\$" + "{NATIVE_HOST_NAME}";

/**
 * Chave PÚBLICA de assinatura (RSA-3072, formato XML do .NET). A privada fica fora do repositório e do servidor, no PC
 * de quem publica (ver scripts/assinar-extensao.mjs). Trocar esta chave exige rodar o instalador de novo nos PCs.
 */
export const UPDATE_PUBLIC_KEY_XML =
  "<RSAKeyValue><Modulus>rT2/aUhOxt7IJqwgt/Vq7JJC58KGEaRreE78D2X06VERHVJyTt71CXk/+gr1B4Yv6UL8QjUz2b68BxXFUvljk6iWVwnhC9fD3VDKVxs2n+rI75mXE4ubx/bS/RtVce14b7Xst2b2t+gnmvFwIGNqyl61iXXWKneQPw01aj6f+S55G+gV99m53CLmpGUpMwavRNLDbBQWYnprHc2nwfgsXtGF/bTFZ+7lWGYmizipkP8H9+0ajcwW+xFpUinmGovBx571DM8ZDH02mkXJz4DvD9rVk7SwwIB531i0tGHxGFjLgS3+QQ8qmH5a06BRKdZEL5KAkyVLvc8sGRQUT/0UgXVAVvSc50BUk2x90vGuAm3en2bRDwE+EzOSu7Y0xzk/an3dRFYAd4QQrxYtnh8IWrN5iCUUlGilh82qa15Aoq+KgfrCHtRkbHcTTNFPv5TXsWSLBPQBIt2LEDrcsOkksodQWQLUzBd2WbS890kE0DqC5V6Y6cdYXyMPAIg2Mx9P</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>";

/**
 * O atualizador. Roda de dois jeitos:
 * - chamado pelo Chrome (mensagens nativas: 1º argumento "chrome-extension://..."): lê o pedido no stdin, atualiza e
 *   responde em JSON no stdout — nada mais pode ir pro stdout, por isso tudo o mais vai pro log;
 * - direto (teste/manutenção): só atualiza e registra no log.
 * Só troca a pasta se o pacote baixado reproduzir EXATAMENTE a lista de arquivos e hashes assinada.
 */
export function updaterScript(baseUrl: string, publicKeyXml: string) {
  // O Chrome passa a origem e, no Windows, um "--parent-window=..." extra: o resto dos argumentos é ignorado.
  return String.raw`param([string]$origem = '', [Parameter(ValueFromRemainingArguments = $true)]$resto)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$base = '${baseUrl}'
$chavePublica = '${publicKeyXml}'
# O atualizador mora em C:\LeitorXML-atualizador (usuário comum não pode criar ARQUIVOS na raiz do C:, só pastas);
# a extensão fica na pasta irmã, C:\LeitorXML.
$dirAtualizador = Split-Path -Parent $PSCommandPath
$pasta = Join-Path (Split-Path -Parent $dirAtualizador) 'LeitorXML'
$log = Join-Path $dirAtualizador 'atualizador.log'
function Log($m) {
  Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $m)
  $linhas = @(Get-Content -LiteralPath $log)
  if ($linhas.Count -gt 300) { $linhas | Select-Object -Last 200 | Set-Content -LiteralPath $log }
}
function Canonico($dir, $versao) {
  $nomes = [string[]]@(Get-ChildItem -LiteralPath $dir -Recurse -File | ForEach-Object { $_.FullName.Substring($dir.Length + 1).Replace('\', '/') })
  [Array]::Sort($nomes, [StringComparer]::Ordinal)
  $linhas = New-Object System.Collections.Generic.List[string]
  $linhas.Add('leitorxml-extensao'); $linhas.Add('versao ' + $versao)
  foreach ($n in $nomes) { $linhas.Add((Get-FileHash -LiteralPath (Join-Path $dir $n) -Algorithm SHA256).Hash.ToLower() + ' ' + $n) }
  return ($linhas -join "${"`"}n")
}
function Atualizar {
  $info = Invoke-RestMethod -Uri ($base + '/api/leitorxml/extensao/assinatura') -TimeoutSec 30
  $local = (Get-Content -LiteralPath (Join-Path $pasta 'manifest.json') -Raw | ConvertFrom-Json).version
  if (-not $info.versao -or ([version]$info.versao) -le ([version]$local)) { return @{ ok = $true; atualizado = $false; versao = $local } }
  $tmp = Join-Path $env:TEMP ('leitorxml-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp 'extensao.zip'
    Invoke-WebRequest -Uri ($base + '/api/leitorxml/extensao/atualizacao') -OutFile $zip -UseBasicParsing -TimeoutSec 120
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    Remove-Item -LiteralPath $zip -Force
    $nova = Join-Path $tmp 'LeitorXML'
    $texto = Canonico $nova $info.versao
    $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
    $rsa.FromXmlString($chavePublica)
    if (-not $rsa.VerifyData([Text.Encoding]::UTF8.GetBytes($texto), 'SHA256', [Convert]::FromBase64String($info.assinatura))) {
      throw ('ASSINATURA_INVALIDA: o pacote da versão ' + $info.versao + ' não bate com a assinatura — nada foi instalado')
    }
    $versaoPacote = (Get-Content -LiteralPath (Join-Path $nova 'manifest.json') -Raw | ConvertFrom-Json).version
    if ($versaoPacote -ne $info.versao) { throw ('o pacote diz versão ' + $versaoPacote + ', a assinatura ' + $info.versao) }
    Get-ChildItem -LiteralPath $pasta | Remove-Item -Recurse -Force
    Copy-Item -Path (Join-Path $nova '*') -Destination $pasta -Recurse -Force
    Log ('atualizado de ' + $local + ' para ' + $info.versao)
    return @{ ok = $true; atualizado = $true; de = $local; para = $info.versao }
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
if ($origem -like 'chrome-extension://*') {
  $entrada = [Console]::OpenStandardInput()
  $tamanho = New-Object byte[] 4
  [void]$entrada.Read($tamanho, 0, 4)
  $corpo = New-Object byte[] ([BitConverter]::ToInt32($tamanho, 0))
  $lidos = 0
  while ($lidos -lt $corpo.Length) { $n = $entrada.Read($corpo, $lidos, $corpo.Length - $lidos); if ($n -le 0) { break }; $lidos += $n }
  try { $resposta = Atualizar } catch { Log ('erro: ' + $_.Exception.Message); $resposta = @{ ok = $false; erro = $_.Exception.Message } }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($resposta | ConvertTo-Json -Compress))
  $saida = [Console]::OpenStandardOutput()
  $saida.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $saida.Write($bytes, 0, $bytes.Length)
  $saida.Flush()
  exit 0
}
try { $r = Atualizar; if (-not $r.atualizado) { Log ('já está na versão ' + $r.versao) } } catch { Log ('erro: ' + $_.Exception.Message) }
`;
}

function powershellScript(zipBase64: string, updateBaseUrl: string) {
  const updaterB64 = Buffer.from(updaterScript(updateBaseUrl, UPDATE_PUBLIC_KEY_XML).replace(/\r?\n/g, "\r\n"), "utf8").toString("base64");
  return String.raw`$ErrorActionPreference = 'Stop'
$b64 = '${zipBase64}'
$atualizadorB64 = '${updaterB64}'
$raiz = if ($env:LEITORXML_DEST) { $env:LEITORXML_DEST } else { 'C:\' }
$pasta = Join-Path $raiz 'LeitorXML'
$quiet = [bool]$env:LEITORXML_QUIET
if (-not $quiet) { Add-Type -AssemblyName System.Windows.Forms }
function Aviso($texto, $icone) { if (-not $quiet) { [void][System.Windows.Forms.MessageBox]::Show($texto, 'Leitor de XML', 'OK', $icone) } }
# ID que o Chrome dá a uma extensão carregada de uma pasta: SHA-256 do caminho (UTF-16, letra do drive maiúscula), 32 letras a–p.
function IdDaPasta($caminho) {
  $sha = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::Unicode.GetBytes($caminho))
  return -join ($sha[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
}
try {
  $jaExistia = Test-Path $pasta
  $zip = Join-Path $env:TEMP 'leitor-de-xml-extensao.zip'
  [IO.File]::WriteAllBytes($zip, [Convert]::FromBase64String($b64))
  if ($jaExistia) { Remove-Item $pasta -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $raiz -Force
  Remove-Item $zip -Force
  if (-not (Test-Path (Join-Path $pasta 'manifest.json'))) { throw 'Os arquivos da extensão não foram extraídos.' }

  # Atualizador: ao lado da pasta (ela é trocada a cada versão), registrado no Chrome só para esta extensão.
  $dirAtualizador = Join-Path $raiz 'LeitorXML-atualizador'
  New-Item -ItemType Directory -Path $dirAtualizador -Force | Out-Null
  $atualizador = Join-Path $dirAtualizador 'atualizador.ps1'
  [IO.File]::WriteAllBytes($atualizador, [Convert]::FromBase64String($atualizadorB64))
  $host_bat = Join-Path $dirAtualizador 'atualizador.bat'
  Set-Content -LiteralPath $host_bat -Encoding ASCII -Value ('@echo off' + [Environment]::NewLine + 'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizador.ps1" %*')
  $caminhoPasta = (Get-Item -LiteralPath $pasta).FullName
  $caminhoPasta = $caminhoPasta.Substring(0, 1).ToUpper() + $caminhoPasta.Substring(1)
  $ids = @(IdDaPasta $caminhoPasta)
  # Também a extensão já carregada de outra pasta neste PC (ex.: a pasta do código), achada nos perfis do Chrome.
  Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data') -Filter 'Secure Preferences' -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $prefs = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
      $prefs.extensions.settings.PSObject.Properties | Where-Object { $_.Value.path -and (Test-Path (Join-Path $_.Value.path 'manifest.json')) } | ForEach-Object {
        if ((Get-Content -LiteralPath (Join-Path $_.Value.path 'manifest.json') -Raw) -match '"name":\s*"Leitor de XML') { $ids += $_.Name }
      }
    } catch { }
  }
  $hostManifest = Join-Path $dirAtualizador 'atualizador.json'
  $origens = @($ids | Select-Object -Unique | ForEach-Object { 'chrome-extension://' + $_ + '/' })
  @{ name = '${NATIVE_HOST_NAME}'; description = 'Atualizador do Leitor de XML'; path = $host_bat; type = 'stdio'; allowed_origins = $origens } | ConvertTo-Json | Set-Content -LiteralPath $hostManifest -Encoding ASCII
  if (-not $quiet) {
    $chave = '${CHAVE_REGISTRO}'
    # Apaga a chave com nome errado deixada pelo instalador com defeito (ver CHAVE_REGISTRO_ERRADA).
    Remove-Item -LiteralPath '${CHAVE_REGISTRO_ERRADA}' -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -Path $chave -Force | Out-Null
    Set-ItemProperty -Path $chave -Name '(default)' -Value $hostManifest
    # Confere: sem esta chave o Chrome não acha o atualizador (visto em 14/10/2026: arquivos gravados, chave ausente).
    if ((Get-ItemProperty -Path $chave -ErrorAction SilentlyContinue).'(default)' -ne $hostManifest) { throw 'Não consegui registrar o atualizador no Chrome (registro do Windows).' }
    Add-Content -LiteralPath (Join-Path $dirAtualizador 'atualizador.log') -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' instalador: atualizador registrado no Chrome para ' + ($origens -join ', '))
  }
} catch {
  Aviso ("Não consegui instalar:" + [Environment]::NewLine + $_.Exception.Message + [Environment]::NewLine + [Environment]::NewLine + "Feche o Chrome e abra este instalador de novo. Se repetir, chame o João.") 'Error'
  exit 1
}
if ($quiet) { Write-Output ('OK ' + $pasta + ' atualizacao=' + $jaExistia); exit 0 }
Set-Clipboard -Value $pasta
try {
  $chrome = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction Stop).'(default)'
  Start-Process $chrome 'chrome://extensions'
} catch { }
$nl = [Environment]::NewLine
$depois = $nl + $nl + 'IMPORTANTE: depois disso, feche o Chrome por completo (todas as janelas e, se houver, o ícone perto do relógio → Sair) e abra de novo. Só assim ele enxerga o atualizador.' + $nl + $nl + 'Daqui pra frente a extensão se atualiza sozinha (ou pelo botão "Atualizar extensão" no popup): não precisa mais rodar este instalador.'
if ($jaExistia) {
  Aviso ('Extensão atualizada.' + $nl + $nl + 'No Chrome (página Extensões), clique na setinha circular de recarregar, no cartão "Leitor de XML".' + $depois) 'Information'
} else {
  Aviso ('Arquivos prontos em ' + $pasta + $nl + $nl + 'Agora, no Chrome (página Extensões que acabou de abrir):' + $nl + '1. Ligue "Modo do desenvolvedor" (canto superior direito).' + $nl + '2. Clique em "Carregar sem compactação".' + $nl + '3. Escolha "Disco Local (C:)", depois a pasta LeitorXML, e clique em "Selecionar pasta".' + $nl + $nl + 'O endereço da pasta já foi copiado: dá para colar na barra da janela com Ctrl+V.' + $depois) 'Information'
}
`;
}

/** Monta o conteúdo do .bat (CRLF). A parte do cmd é só ASCII; o PowerShell vem depois do `exit /b` e nunca é lido pelo cmd. */
export function buildInstallerBat(zip: Buffer, updateBaseUrl = DEFAULT_UPDATE_BASE_URL): Buffer {
  const header = [
    "@echo off",
    "title Instalador - Leitor de XML",
    "echo Instalando a extensao Leitor de XML... aguarde.",
    // O marcador é montado por concatenação para não aparecer escrito nesta linha (senão o split cortaria aqui).
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8; Invoke-Expression ($t -split ('${MARKER.slice(0, 3)}' + '${MARKER.slice(3)}'))[1]"`,
    "exit /b",
    MARKER,
  ].join("\r\n");
  const body = powershellScript(zip.toString("base64"), updateBaseUrl).replace(/\r?\n/g, "\r\n");
  // Sem BOM (o cmd o leria como parte do primeiro comando); o PowerShell lê o arquivo com -Encoding UTF8 explícito.
  return Buffer.from(`${header}\r\n${body}\r\n${MARKER}\r\n`, "utf8");
}
