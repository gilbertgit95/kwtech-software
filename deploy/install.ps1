<#
.SYNOPSIS
  Installs kwtech on this Windows PC (#133 P3): one command, a few questions.

.DESCRIPTION
  1. Prepares Windows (windows\prepare-windows.ps1): WSL, Ubuntu, Docker
     Engine, network sharing, both firewalls, start at boot, never sleep. If
     Windows must restart, it says so and this script continues by itself
     after you sign in again.
  2. Runs install.sh inside WSL, where Docker runs: the settings and their
     secrets, the images, the start, and first setup (the shop and its first
     people).
  3. Makes this PC trust the shop's certificate, so https://localhost opens
     without a warning, and opens it.
  4. Offers to set this PC up for printing (the print agent), if it prints.

  Safe to run again: every step checks first.

.PARAMETER FromImages
  The images from a USB stick (kwtech-images-<version>.tar) for a shop with
  poor internet.

.PARAMETER WhatIf
  Reports what preparing Windows would change, and stops there.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$FromImages = '',
  [string]$Distro = 'Ubuntu',
  [switch]$Resume
)

$ErrorActionPreference = 'Stop'
$DryRun = [bool]$WhatIfPreference
$WhatIfPreference = $false
$env:WSL_UTF8 = '1'
. (Join-Path $PSScriptRoot 'windows\lib\wsl.ps1')

$InstallDir = '/opt/kwtech'

function Say([string]$text) { Write-Host $text }
function Stop-With([string]$text) {
  Write-Host "  [xx] $text" -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host 'kwtech: installing on this PC' -ForegroundColor White

# --- 1. Windows -------------------------------------------------------------
$prepare = Join-Path $PSScriptRoot 'windows\prepare-windows.ps1'
if (-not (Test-Path $prepare)) { Stop-With "This bundle has no windows\prepare-windows.ps1 beside install.ps1 ($PSScriptRoot)." }
$prepareArgs = @{ Distro = $Distro; ThenRun = $PSCommandPath }
if ($DryRun) { $prepareArgs.WhatIf = $true }
& $prepare @prepareArgs
if ($LASTEXITCODE -eq 3010) { exit 0 }   # a restart is pending; we continue after it
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($DryRun) {
  Write-Host ''
  Write-Host '-WhatIf: stopping before the install itself (install.sh inside WSL).'
  exit 0
}
if (-not (Test-Admin)) { Stop-With 'Run PowerShell as Administrator.' }

# --- 2. The install, inside WSL ----------------------------------------------
Write-Host ''
Write-Host 'The app, inside WSL' -ForegroundColor White
<#
  The bundle's folder as WSL sees it (C:\kwtech-install -> /mnt/c/kwtech-install).
  !! Through stdin (Invoke-InDistro), never as an argument: a path with spaces
  or quotes would be mangled by Windows PowerShell 5.1 (lib\wsl.ps1).
#>
$bundle = (Invoke-InDistro "wslpath -a '$($PSScriptRoot -replace "'", "'\''")'")
if (-not $bundle) { Stop-With "WSL cannot see this folder ($PSScriptRoot). Copy the bundle to a folder on drive C:, such as C:\kwtech-install." }
$bundle = $bundle.Trim()

$arguments = @('-d', $Distro, '-u', 'root', '--cd', $bundle, '--exec', 'bash', './install.sh', '--dir', $InstallDir)
if ($FromImages) {
  $images = (Invoke-InDistro "wslpath -a '$($FromImages -replace "'", "'\''")'")
  if (-not $images) { Stop-With "WSL cannot see $FromImages." }
  $arguments += @('--from-images', $images.Trim())
}
# Interactive: the questions and first setup talk to this window directly.
& wsl.exe @arguments
if ($LASTEXITCODE -ne 0) { Stop-With 'The install inside WSL stopped (its last lines above say why). Fix it and run this again: it continues where it can.' }

# --- 3. This PC trusts the shop's certificate --------------------------------
Write-Host ''
Write-Host "This PC and the shop's certificate" -ForegroundColor White
$pem = Invoke-Wsl @('-d', $Distro, '-u', 'root', '--exec', "$InstallDir/kwtech", 'certificate')
if ($LASTEXITCODE -ne 0 -or -not ($pem -join "`n").Contains('BEGIN CERTIFICATE')) {
  Write-Host "  [!!] Could not read the shop's certificate; import it by hand (docs/HTTPS.md section 5, Windows)." -ForegroundColor Yellow
} else {
  $file = Join-Path $env:TEMP 'kwtech-local-ca.crt'
  Set-Content -Path $file -Value ($pem -join "`n") -Encoding ASCII
  $certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($file)
  $known = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $certificate.Thumbprint }
  if ($known) {
    Write-Host "  [ok] This PC already trusts it ($($certificate.Thumbprint))" -ForegroundColor Green
  } else {
    Import-Certificate -FilePath $file -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
    Write-Host "  [..] Trusted on this PC: $($certificate.Subject) ($($certificate.Thumbprint))" -ForegroundColor Cyan
  }
  Remove-Item $file -Force
}

# --- 4. Printing on this PC ----------------------------------------------------
$agentInstaller = Join-Path $PSScriptRoot 'windows\install-print-agent.ps1'
if (Test-Path $agentInstaller) {
  Write-Host ''
  $answer = Read-Host 'Will this PC print (a printer connected to it)? (y/N)'
  if ($answer -match '^(y|yes)$') { & $agentInstaller -ThisPc }
}

# --- 5. Hand-off ----------------------------------------------------------------
$address = ((Invoke-Wsl @('-d', $Distro, '-u', 'root', '--exec', "$InstallDir/kwtech", 'address')) -join '').Trim()
$adapter = Get-NetIPAddress -IPAddress $address -ErrorAction SilentlyContinue | Get-NetAdapter -ErrorAction SilentlyContinue
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host "  On this PC:           https://localhost   (not ${address}: Windows does not route its own address into WSL)"
Write-Host "  Phones and other PCs: https://$address"
if ($adapter) {
  Write-Host ''
  Write-Host "Reserve $address for this PC on the router: MAC address $($adapter.MacAddress) ($($adapter.Name))." -ForegroundColor Yellow
}
Write-Host ''
Write-Host 'Later, from PowerShell:'
Write-Host "  wsl -d $Distro -u root kwtech status            (is everything running)"
Write-Host "  wsl -d $Distro -u root kwtech recover-account   (a new password for an account)"
Start-Process 'https://localhost'
