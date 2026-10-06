# Testes do robô no PC, sem digitar o token e a senha toda vez — e sem deixá-los em texto aberto.
#
#   powershell -ExecutionPolicy Bypass -File robo\local.ps1 salvar       (uma vez: pede o token e a senha, escondidos)
#   powershell -ExecutionPolicy Bypass -File robo\local.ps1 rastrear     (roda o robô; opcional: -MaxEmpresas 5)
#   powershell -ExecutionPolicy Bypass -File robo\local.ps1 apagar       (esquece os segredos guardados)
#
# Os segredos ficam em %USERPROFILE%\.leitorxml-robo\*.sec, criptografados pelo Windows (DPAPI): só ESTE usuário,
# NESTE PC, consegue decifrar. Ao rodar, vão só pro ambiente do processo do robô e somem quando ele termina.
param(
  [Parameter(Position = 0)][ValidateSet("salvar", "rastrear", "apagar")][string]$Acao = "rastrear",
  [string]$Pfx = "$env:USERPROFILE\Downloads\001 - ASSESSORIA CONTABIL MOREIRA & CASTRO- venc. 01-12-2026.pfx",
  [int]$MaxEmpresas = 5
)

$ErrorActionPreference = "Stop"
$dir = Join-Path $env:USERPROFILE ".leitorxml-robo"
$tokenFile = Join-Path $dir "token.sec"
$passFile = Join-Path $dir "a1pass.sec"

function ConvertTo-PlainText([System.Security.SecureString]$secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

switch ($Acao) {
  "salvar" {
    New-Item -ItemType Directory -Force $dir | Out-Null
    icacls $dir /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" | Out-Null
    Read-Host "Token do robô (não aparece)" -AsSecureString | ConvertFrom-SecureString | Set-Content -Path $tokenFile
    Read-Host "Senha do certificado A1 (não aparece)" -AsSecureString | ConvertFrom-SecureString | Set-Content -Path $passFile
    Write-Host "Guardado, criptografado, em $dir"
  }
  "apagar" {
    Remove-Item $tokenFile, $passFile -ErrorAction SilentlyContinue
    Write-Host "Segredos apagados."
  }
  "rastrear" {
    if (-not (Test-Path $tokenFile) -or -not (Test-Path $passFile)) { throw "Rode primeiro:  powershell -ExecutionPolicy Bypass -File robo\local.ps1 salvar" }
    if (-not (Test-Path $Pfx)) { throw "Certificado não encontrado: $Pfx (use -Pfx 'caminho')" }
    $env:ROBO_TOKEN = ConvertTo-PlainText (Get-Content $tokenFile | ConvertTo-SecureString)
    $env:ROBO_A1PASS = ConvertTo-PlainText (Get-Content $passFile | ConvertTo-SecureString)
    $env:ROBO_PFX = $Pfx
    try {
      Set-Location (Split-Path $PSScriptRoot -Parent)
      node robo/src/cli.ts rastrear --max-empresas $MaxEmpresas
    } finally {
      Remove-Item Env:ROBO_TOKEN, Env:ROBO_A1PASS -ErrorAction SilentlyContinue
    }
  }
}
