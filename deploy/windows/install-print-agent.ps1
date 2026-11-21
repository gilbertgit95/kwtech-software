<#
.SYNOPSIS
  Sets up a Windows PC to print for kwtech (#133 P5): the print agent, paired
  and started with Windows, by one script.

.DESCRIPTION
  Does what apps/print-agent/README.md "Setting up a computer" does by hand,
  with nothing to build and no npm:

  1. Checks the PC (Windows 10 or 11, 64-bit, Administrator) and installs
     Node.js 22 for Windows with winget if it is missing.
  2. Unpacks the release's print agent zip into C:\kwtech-print-agent,
     downloaded and checked against the release's SHA256SUMS.txt (or -Zip).
  3. Points it at the server and makes it trust the shop's certificate:
     on the server PC itself through https://localhost, on any other PC
     through https://<address>, after you compare the fingerprint.
  4. Lists the printers Windows has, pairs with the code from the Printers
     page, and starts the agent at sign-in of this Windows user.

  Running it again updates the agent and keeps the pairing and the settings.

.PARAMETER ThisPc
  This PC is the kwtech server (install.ps1 passes it).
.PARAMETER Server
  The server's address on the shop's network (asked when not given).
.PARAMETER Code
  The pairing code from the workspace's Printers page (asked when not given).
.PARAMETER Version
  The release to install. Default: the server's own on the server PC, else the newest.
.PARAMETER Zip
  A print agent zip already on this PC (kwtech-print-agent-<version>.zip), for no internet.
.PARAMETER WhatIf
  Says what it would do, and changes nothing.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$ThisPc,
  [string]$Server = '',
  [string]$Code = '',
  [string]$Version = '',
  [string]$Zip = '',
  [string]$Folder = 'C:\kwtech-print-agent',
  [string]$Distro = 'Ubuntu'
)

$ErrorActionPreference = 'Stop'
$DryRun = [bool]$WhatIfPreference
$WhatIfPreference = $false
$env:WSL_UTF8 = '1'
. (Join-Path $PSScriptRoot 'lib\wsl.ps1')

$Repo = 'gilbertgit95/kwtech-software'
$TaskName = 'kwtech print agent'
$Planned = New-Object System.Collections.Generic.List[string]

function Say-Ok([string]$text) { Write-Host "  [ok] $text" -ForegroundColor Green }
function Say-Do([string]$text) { Write-Host "  [..] $text" -ForegroundColor Cyan }
function Stop-With([string]$text) {
  Write-Host "  [xx] $text" -ForegroundColor Red
  exit 1
}
function Invoke-Step([string]$what, [scriptblock]$action) {
  if ($DryRun) { $Planned.Add($what); return }
  Say-Do $what
  & $action
}

<# The certificate's SHA-256 fingerprint as the Local network page shows it: AB:CD:... #>
function Get-Fingerprint([string]$path) {
  $certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($path)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = $sha.ComputeHash($certificate.RawData)
  return (($bytes | ForEach-Object { $_.ToString('X2') }) -join ':')
}

Write-Host ''
Write-Host 'kwtech: setting up this PC to print' -ForegroundColor White
if ($DryRun) { Write-Host '  (-WhatIf: nothing will be changed)' }

# --- 1. The PC and Node.js ------------------------------------------------------
Write-Host ''
Write-Host 'This PC'
if (-not (Test-Admin) -and -not $DryRun) { Stop-With 'Run PowerShell as Administrator.' }
if (-not [Environment]::Is64BitOperatingSystem) { Stop-With 'A 64-bit Windows is needed.' }
Say-Ok (Get-CimInstance Win32_OperatingSystem).Caption

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$nodeMajor = 0
if ($node) { $nodeMajor = [int](((& node.exe -v) -replace '^v', '').Split('.')[0]) }
if ($nodeMajor -ge 22) {
  Say-Ok "Node.js $(& node.exe -v)"
} else {
  Invoke-Step 'Install Node.js 22 for Windows (winget, OpenJS.NodeJS.22)' {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
      Stop-With 'winget is missing. Install Node.js 22 for Windows from nodejs.org, then run this again.'
    }
    & winget.exe install --id OpenJS.NodeJS.22 --exact --silent --accept-package-agreements --accept-source-agreements | Out-Null
    # The new PATH, without opening a new window.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { Stop-With 'Node.js did not install. Install Node.js 22 from nodejs.org, then run this again.' }
  }
}

# --- 2. The agent ------------------------------------------------------------------
Write-Host ''
Write-Host 'The print agent'
if (-not $Version -and $ThisPc) {
  $Version = ((Invoke-Wsl @('-d', $Distro, '-u', 'root', '--exec', '/opt/kwtech/kwtech', 'version')) -join '').Trim()
}
$work = Join-Path $env:TEMP 'kwtech-print-agent-setup'
Invoke-Step "Unpack the print agent$(if ($Version) { " $Version" }) into $Folder (the pairing and settings are kept)" {
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  if (-not $Zip) {
    $base = if ($Version) { "https://github.com/$Repo/releases/download/v$Version" } else { "https://github.com/$Repo/releases/latest/download" }
    $name = if ($Version) { "kwtech-print-agent-$Version.zip" } else { 'kwtech-print-agent.zip' }
    $Zip = Join-Path $work $name
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $Zip
    $sums = Join-Path $work 'SHA256SUMS.txt'
    Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS.txt" -OutFile $sums
    $expected = (Get-Content $sums | Where-Object { $_ -match " $([regex]::Escape($name))$" } | Select-Object -First 1)
    if (-not $expected) { Stop-With "The release lists no checksum for ${name}: not using it." }
    $actual = (Get-FileHash -Algorithm SHA256 -Path $Zip).Hash.ToLower()
    if ($expected.Split(' ')[0].ToLower() -ne $actual) { Stop-With "$name does not match the release's checksum: not using it." }
  }
  # Stop a running agent before replacing it; the task starts it again below.
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*print-agent.mjs*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Force -Path $Folder | Out-Null
  # The release's files only: .env.local and the certificate stay; the pairing is in %APPDATA%.
  Expand-Archive -Path $Zip -DestinationPath $Folder -Force
}

# --- 3. The server, and trusting its certificate -------------------------------
Write-Host ''
Write-Host 'The server'
$certificateFile = Join-Path $Folder 'kwtech-local-ca.crt'
if ($ThisPc) {
  # Docker publishes only Caddy's 80 and 443, so even here the agent goes through https://localhost.
  $address = 'localhost'
  Invoke-Step "Take the shop's certificate from this PC's own install" {
    $pem = Invoke-Wsl @('-d', $Distro, '-u', 'root', '--exec', '/opt/kwtech/kwtech', 'certificate')
    if (-not ($pem -join "`n").Contains('BEGIN CERTIFICATE')) { Stop-With "Could not read the shop's certificate from this PC's install." }
    Set-Content -Path $certificateFile -Value ($pem -join "`n") -Encoding ASCII
  }
} else {
  if (-not $Server) { $Server = (Read-Host "  The server's address on the shop's network (e.g. 192.168.1.186)").Trim() }
  if (-not $Server) { Stop-With 'No server address.' }
  $address = $Server
  Invoke-Step "Download the shop's certificate from http://$address and compare its fingerprint" {
    Invoke-WebRequest -UseBasicParsing -Uri "http://$address/kwtech-local-ca.crt" -OutFile $certificateFile
    $fingerprint = Get-Fingerprint $certificateFile
    Write-Host ''
    Write-Host "  Its SHA-256 fingerprint:  $fingerprint"
    Write-Host '  Compare it, character by character, with the one on the Local network page (Server, Local network).'
    $same = Read-Host '  Exactly the same? (y/N)'
    if ($same -notmatch '^(y|yes)$') {
      Remove-Item $certificateFile -Force
      Stop-With 'Not the same: this is not the shop''s server, or something is in between. Nothing was set up.'
    }
  }
}
Invoke-Step "Point the agent at https://$address" {
  @(
    "API_URL=`"https://$address/api/v1`"",
    "WS_URL=`"wss://$address/api/v1/graphql`""
  ) | Set-Content -Path (Join-Path $Folder '.env.local') -Encoding ASCII
  # Node trusts the shop's authority only through NODE_EXTRA_CA_CERTS, read
  # when Node starts, so the agent is started through this script.
  @(
    '# Starts the kwtech print agent (install-print-agent.ps1): Node trusts the shop''s certificate only through this variable.',
    "`$env:NODE_EXTRA_CA_CERTS = '$certificateFile'",
    "Set-Location '$Folder'",
    '& node.exe print-agent.mjs start'
  ) | Set-Content -Path (Join-Path $Folder 'start-agent.ps1') -Encoding ASCII
}

# --- 4. Printers, pairing, starting ------------------------------------------------
if ($DryRun) {
  $Planned.Add('List the printers, pair with the code from the Printers page, and start the agent at sign-in of this user')
  Write-Host ''
  Write-Host 'Would do:' -ForegroundColor Cyan
  foreach ($item in $Planned) { Write-Host "  - $item" }
  exit 0
}

$env:NODE_EXTRA_CA_CERTS = $certificateFile
Push-Location $Folder
try {
  Write-Host ''
  Write-Host 'The printers Windows has (about half a minute)'
  & node.exe print-agent.mjs printers
  $status = (& node.exe print-agent.mjs status) -join "`n"
  if ($status -match '^Paired as') {
    Say-Ok ($status.Split("`n")[0])
  } else {
    Write-Host ''
    Write-Host '  On the workspace''s Printers page: Add a computer, name it after this PC. It shows a code (once, for 10 minutes).'
    if (-not $Code) { $Code = (Read-Host '  The pairing code').Trim() }
    & node.exe print-agent.mjs pair $Code
    if ($LASTEXITCODE -ne 0) { Stop-With 'Pairing failed (the line above says why). A code works once, for 10 minutes: make a new one and run this again.' }
  }
} finally {
  Pop-Location
}

# The pairing is kept per Windows user, so the agent runs as THIS user, at sign-in.
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $Folder 'start-agent.ps1')`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -User "$env:USERDOMAIN\$env:USERNAME" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Say-Ok "The agent starts when $env:USERNAME signs in (task '$TaskName'), and runs now"

Write-Host ''
Write-Host 'Done. On the Printers page this PC shows Online within a minute.' -ForegroundColor Green
Write-Host 'Left to do:'
Write-Host '  - Test print on each printer from the Printers page, and measure the page.'
Write-Host '  - Set this PC to sign in automatically and never sleep, or it stops printing after a power cut.'
