/**
 * Instalador de 1 clique: um .bat que carrega, embutido, o ZIP da extensão. Ao abrir, extrai em C:\LeitorXML,
 * copia o caminho, abre o chrome://extensions e mostra os 3 cliques que o Chrome não deixa automatizar
 * (extensões fora da loja exigem o "Modo do desenvolvedor").
 *
 * Variáveis para teste (não usadas no dia a dia): LEITORXML_DEST troca a raiz C:\ e LEITORXML_QUIET pula Chrome e janelas.
 */
const MARKER = "#PS#";

function powershellScript(zipBase64: string) {
  return String.raw`$ErrorActionPreference = 'Stop'
$b64 = '${zipBase64}'
$raiz = if ($env:LEITORXML_DEST) { $env:LEITORXML_DEST } else { 'C:\' }
$pasta = Join-Path $raiz 'LeitorXML'
$quiet = [bool]$env:LEITORXML_QUIET
if (-not $quiet) { Add-Type -AssemblyName System.Windows.Forms }
function Aviso($texto, $icone) { if (-not $quiet) { [void][System.Windows.Forms.MessageBox]::Show($texto, 'Leitor de XML', 'OK', $icone) } }
try {
  $jaExistia = Test-Path $pasta
  $zip = Join-Path $env:TEMP 'leitor-de-xml-extensao.zip'
  [IO.File]::WriteAllBytes($zip, [Convert]::FromBase64String($b64))
  if ($jaExistia) { Remove-Item $pasta -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $raiz -Force
  Remove-Item $zip -Force
  if (-not (Test-Path (Join-Path $pasta 'manifest.json'))) { throw 'Os arquivos da extensão não foram extraídos.' }
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
if ($jaExistia) {
  Aviso ('Extensão atualizada.' + $nl + $nl + 'No Chrome (página Extensões), clique na setinha circular de recarregar, no cartão "Leitor de XML".') 'Information'
} else {
  Aviso ('Arquivos prontos em ' + $pasta + $nl + $nl + 'Agora, no Chrome (página Extensões que acabou de abrir):' + $nl + '1. Ligue "Modo do desenvolvedor" (canto superior direito).' + $nl + '2. Clique em "Carregar sem compactação".' + $nl + '3. Escolha "Disco Local (C:)", depois a pasta LeitorXML, e clique em "Selecionar pasta".' + $nl + $nl + 'O endereço da pasta já foi copiado: dá para colar na barra da janela com Ctrl+V.') 'Information'
}
`;
}

/** Monta o conteúdo do .bat (CRLF). A parte do cmd é só ASCII; o PowerShell vem depois do `exit /b` e nunca é lido pelo cmd. */
export function buildInstallerBat(zip: Buffer): Buffer {
  const header = [
    "@echo off",
    "title Instalador - Leitor de XML",
    "echo Instalando a extensao Leitor de XML... aguarde.",
    // O marcador é montado por concatenação para não aparecer escrito nesta linha (senão o split cortaria aqui).
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$t = Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8; Invoke-Expression ($t -split ('${MARKER.slice(0, 3)}' + '${MARKER.slice(3)}'))[1]"`,
    "exit /b",
    MARKER,
  ].join("\r\n");
  const body = powershellScript(zip.toString("base64")).replace(/\r?\n/g, "\r\n");
  // Sem BOM (o cmd o leria como parte do primeiro comando); o PowerShell lê o arquivo com -Encoding UTF8 explícito.
  return Buffer.from(`${header}\r\n${body}\r\n${MARKER}\r\n`, "utf8");
}
