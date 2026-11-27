<#
.SYNOPSIS
  Prepares a Windows 11 PC to serve kwtech on the shop's network (#211, #133 P0b).

.DESCRIPTION
  Does, in order, what docs/HTTPS.md section 4 step 1 does by hand, and what
  a Docker install needs before it: checks the PC, installs WSL with Ubuntu and Docker Engine inside it, shares
  the network with WSL (mirrored networking), marks the shop's network
  Private, opens ports 80 and 443 in BOTH firewalls, keeps WSL running (at
  boot, at sign-in and every 5 minutes), turns off Fast Startup, and keeps
  the PC from sleeping.

  Every step checks first and skips what is already done, so running it again
  is always safe. A step that needs a restart says so, registers itself to
  continue after the next sign-in, and stops.

  Output is plain ASCII on purpose: Windows PowerShell 5.1 reads a script
  without a byte-order mark as the machine's code page, and anything else
  prints as garbage on some PCs.

.PARAMETER Distro
  The WSL distribution to use. Default: Ubuntu.

.PARAMETER WhatIf
  Reports what it would change, and changes nothing. Runs without
  Administrator too, reading only.

.PARAMETER Resume
  Used by the task it registers to continue after a restart. Not needed by hand.

.PARAMETER ThenRun
  A script to run after the restart instead of this one: install.ps1 passes
  itself, so the whole install continues by itself. Exit code 3010 (Windows'
  "restart needed") tells the caller a restart is pending.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\prepare-windows.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\prepare-windows.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Distro = 'Ubuntu',
  [switch]$Resume,
  [string]$ThenRun = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\wslconfig.ps1')
. (Join-Path $PSScriptRoot 'lib\wsl.ps1')
# Our own dry-run flag. PowerShell's -WhatIf would also reach every cmdlet it
# loads ("What if: Set Alias gcim..." on module import), burying the report.
$DryRun = [bool]$WhatIfPreference
$WhatIfPreference = $false
# wsl.exe writes UTF-16 unless told otherwise, which arrives as text with a
# NUL between every letter and matches nothing.
$env:WSL_UTF8 = '1'

# WSL's id in the Hyper-V firewall: the same on every PC (docs/HTTPS.md, 1c).
$WslVmCreatorId = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'
# The names docs/HTTPS.md uses, so rules made by hand count as done.
$RuleName = 'kwtech HTTPS'
$HyperVRuleId = 'kwtech-https'
$Ports = @(80, 443)
$BootTaskName = 'kwtech WSL at startup'
$ResumeTaskName = 'kwtech prepare (continue)'
# Windows 11 22H2: mirrored networking and the Hyper-V firewall need it.
$MinimumBuild = 22621

$script:Changed = New-Object System.Collections.Generic.List[string]
$script:Planned = New-Object System.Collections.Generic.List[string]
$script:LeftToDo = New-Object System.Collections.Generic.List[string]
$script:RestartWsl = $false

function Say-Ok([string]$text) { Write-Host "  [ok] $text" -ForegroundColor Green }
function Say-Do([string]$text) { Write-Host "  [..] $text" -ForegroundColor Cyan }
function Say-Warn([string]$text) { Write-Host "  [!!] $text" -ForegroundColor Yellow }
function Stop-With([string]$text) {
  Write-Host "  [xx] $text" -ForegroundColor Red
  exit 1
}

<#
  Runs $action when allowed, recording it either way. Under -WhatIf, nothing
  runs and the change is listed as planned.
#>
function Invoke-Change([string]$what, [scriptblock]$action) {
  if ($DryRun) {
    $script:Planned.Add($what)
    return
  }
  Say-Do $what
  & $action
  $script:Changed.Add($what)
}

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host 'kwtech: preparing this PC to serve the shop' -ForegroundColor White
if ($DryRun) { Write-Host '  (-WhatIf: nothing will be changed)' }
Write-Host ''

# A restart brought us back: the continue-task has done its job.
if (Get-ScheduledTask -TaskName $ResumeTaskName -ErrorAction SilentlyContinue) {
  if (-not $DryRun) { Unregister-ScheduledTask -TaskName $ResumeTaskName -Confirm:$false }
}

# --- 1. Checks -------------------------------------------------------------
Write-Host 'Checking this PC'
$isAdmin = Test-Admin
if ($isAdmin) {
  Say-Ok 'Running as Administrator'
} elseif ($DryRun) {
  Say-Warn 'Not Administrator: reading only. The real run needs "Run as administrator".'
} else {
  Stop-With 'Run PowerShell as Administrator: Start, type PowerShell, right-click, Run as administrator.'
}

$build = [Environment]::OSVersion.Version.Build
$caption = (Get-CimInstance Win32_OperatingSystem).Caption
if ($build -lt $MinimumBuild) {
  Stop-With "$caption (build $build). Windows 11 version 22H2 or newer is needed: update Windows (Settings, Windows Update). Windows 10 cannot be the server."
}
if (-not [Environment]::Is64BitOperatingSystem) { Stop-With 'A 64-bit Windows is needed.' }
Say-Ok "$caption, build $build"

$hypervisor = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
$firmware = (Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled
if ($hypervisor -or $firmware) {
  Say-Ok 'Virtualization is on'
} else {
  Stop-With 'Virtualization is off in this PC''s firmware, and WSL needs it. Restart into the BIOS/UEFI settings (usually F2, F10 or Del while starting), turn on Intel VT-x / AMD-V / SVM, save, and run this again.'
}

# Ports 80 and 443: free, or already held by WSL (a set-up server answering through mirrored networking).
$wslProcesses = @('wslrelay', 'wslhost', 'wslservice', 'vmmem', 'vmmemWSL', 'vmcompute', 'svchost')
$busy = foreach ($port in $Ports) {
  $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    $name = if ($process) { $process.ProcessName } else { "process $($listener.OwningProcess)" }
    if ($wslProcesses -notcontains $name) { "port $port is in use by $name" }
  }
}
if ($busy) {
  Stop-With ("Ports 80 and 443 must be free for the app. " + (($busy | Select-Object -Unique) -join '; ') + '. Stop or uninstall that program (often IIS, Skype or another web server), then run this again.')
}
Say-Ok 'Ports 80 and 443 are free (or already the app''s)'

# --- 2. WSL and the distribution -------------------------------------------
Write-Host ''
Write-Host 'WSL and Ubuntu'
Invoke-Wsl @('--status') | Out-Null
if ($LASTEXITCODE -ne 0) {
  Invoke-Change 'Install WSL (Windows restarts afterwards)' {
    Invoke-Wsl @('--install', '--no-distribution') | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-With 'wsl --install failed. Check Windows Update is working, and run this again.' }
  }
  if (-not $DryRun) {
    $next = if ($ThenRun) { $ThenRun } else { $PSCommandPath }
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$next`" -Distro `"$Distro`" -Resume"
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    Register-ScheduledTask -TaskName $ResumeTaskName -Action $action -Trigger $trigger -RunLevel Highest -User "$env:USERDOMAIN\$env:USERNAME" -Force | Out-Null
    Write-Host ''
    Write-Host 'Windows needs to restart to finish installing WSL. Save your work, restart, and sign in again' -ForegroundColor Yellow
    Write-Host 'as this same user: this script continues by itself.' -ForegroundColor Yellow
    # 3010: Windows' own "restart needed", so install.ps1 knows to stop here.
    exit 3010
  }
} else {
  Say-Ok 'WSL is installed'
  Invoke-Change 'Update WSL, if a newer version exists' { Invoke-Wsl @('--update') | Out-Null }
}

$distros = (Invoke-Wsl @('-l', '-q')) | ForEach-Object { $_.Trim() } | Where-Object { $_ }
if ($distros -contains $Distro) {
  Say-Ok "$Distro is installed"
} else {
  Invoke-Change "Install $Distro in WSL" {
    Invoke-Wsl @('--install', '-d', $Distro, '--no-launch') | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-With "Installing $Distro failed. Run 'wsl --install -d $Distro' by hand to see why." }
    # The first start registers it; as root, so no user has to be made here.
    Invoke-Wsl @('-d', $Distro, '-u', 'root', '--', 'true') | Out-Null
  }
}

# systemd, so Docker (and anything else installed as a service) starts with the distro.
$systemd = Invoke-InDistro "grep -Eq '^[[:space:]]*systemd[[:space:]]*=[[:space:]]*true' /etc/wsl.conf && echo yes"
if ($systemd -eq 'yes') {
  Say-Ok 'systemd is on in the distro'
} else {
  Invoke-Change "Turn on systemd in $Distro (/etc/wsl.conf)" {
    Invoke-InDistro "grep -q '^\[boot\]' /etc/wsl.conf 2>/dev/null && sed -i '/^\[boot\]/a systemd=true' /etc/wsl.conf || printf '[boot]\nsystemd=true\n' >> /etc/wsl.conf" | Out-Null
    $script:RestartWsl = $true
  }
}

# --- 3. Docker Engine inside the distro -------------------------------------
Write-Host ''
Write-Host 'Docker Engine (inside WSL; not Docker Desktop)'
$dockerVersion = Invoke-InDistro "docker version --format '{{.Server.Version}}' 2>/dev/null"
if ($dockerVersion) {
  Say-Ok "Docker Engine $dockerVersion"
} else {
  Invoke-Change "Install Docker Engine in $Distro (Docker's own apt repository)" {
    # Docker's documented steps for Ubuntu (docs.docker.com/engine/install/ubuntu).
    $install = @'
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -q
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker 2>/dev/null || service docker start
'@
    $result = Invoke-InDistro ($install -replace "`r", '')
    if ($null -eq $result) { Stop-With "Installing Docker Engine failed. Check the internet connection, then run this again." }
  }
}

# --- 4. Sharing the network with WSL -------------------------------------
Write-Host ''
Write-Host 'Network'
$wslConfigPath = Join-Path $env:USERPROFILE '.wslconfig'
$wanted = [ordered]@{ networkingMode = 'mirrored'; vmIdleTimeout = '-1' }
$lines = if (Test-Path $wslConfigPath) { @(Get-Content $wslConfigPath) } else { @() }

$missing = @($wanted.Keys | Where-Object { (Get-WslConfigValue $lines $_) -ne $wanted[$_] })
if ($missing.Count -eq 0) {
  Say-Ok 'WSL shares the PC''s network (mirrored), and stays running with no window open'
} else {
  Invoke-Change ("Set " + ($missing -join ', ') + " in $wslConfigPath") {
    $out = Set-WslConfigValues $lines $wanted
    Set-Content -Path $wslConfigPath -Value $out -Encoding ASCII
    $script:RestartWsl = $true
  }
}

$public = @(Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' })
if ($public.Count -eq 0) {
  Say-Ok 'The network is Private (or managed by a domain)'
} else {
  foreach ($connection in $public) {
    Invoke-Change "Mark the network on '$($connection.InterfaceAlias)' Private (the firewall rules cover Private only)" {
      Set-NetConnectionProfile -InterfaceIndex $connection.InterfaceIndex -NetworkCategory Private
    }
  }
}

# Windows Defender Firewall.
if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) {
  Say-Ok "Windows Defender Firewall lets 80 and 443 in ('$RuleName')"
} else {
  Invoke-Change "Open ports 80 and 443 in Windows Defender Firewall ('$RuleName', Private networks)" {
    New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Ports -Profile Private | Out-Null
  }
}

# The Hyper-V firewall in front of WSL: blocks everything coming in by default.
$hyperVRule = $null
try { $hyperVRule = Get-NetFirewallHyperVRule -DisplayName $RuleName -ErrorAction SilentlyContinue } catch { $hyperVRule = $null }
if ($hyperVRule) {
  Say-Ok "The Hyper-V firewall in front of WSL lets 80 and 443 in ('$RuleName')"
} elseif (-not $isAdmin) {
  Say-Warn 'The Hyper-V firewall rule can only be read as Administrator: checked on the real run.'
  $script:Planned.Add("Open ports 80 and 443 in the Hyper-V firewall in front of WSL ('$RuleName'), if missing")
} else {
  Invoke-Change "Open ports 80 and 443 in the Hyper-V firewall in front of WSL ('$RuleName')" {
    New-NetFirewallHyperVRule -Name $HyperVRuleId -DisplayName $RuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPorts $Ports -VMCreatorId $WslVmCreatorId | Out-Null
  }
}

# --- 5. Staying up ---------------------------------------------------------
Write-Host ''
Write-Host 'Staying up'
# The task holds WSL open: its `sleep infinity` keeps the distro, and with
# systemd its Docker, running (vmIdleTimeout=-1 keeps the VM). A boot trigger
# alone is not enough (#237): with Fast Startup, Shut down hibernates and the
# next power-on is a resume, not a boot; and anything that ends the distro
# (wsl --shutdown, a WSL update) ends the task with it, until the next real
# boot. So it also runs at sign-in and every 5 minutes. IgnoreNew makes those
# a watchdog: nothing happens while it runs, and WSL starts again when not.
$bootTask = Get-ScheduledTask -TaskName $BootTaskName -ErrorAction SilentlyContinue
$bootTriggers = if ($bootTask) { @($bootTask.Triggers) } else { @() }
$bootTaskCurrent = $bootTask -and
  @($bootTriggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' }).Count -gt 0 -and
  @($bootTriggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }).Count -gt 0 -and
  @($bootTriggers | Where-Object { $_.Repetition.Interval -eq 'PT5M' }).Count -gt 0 -and
  $bootTask.Settings.MultipleInstances -eq 'IgnoreNew'
if ($bootTaskCurrent) {
  Say-Ok "WSL is kept running: at startup, at sign-in and every 5 minutes ('$BootTaskName')"
} else {
  $what = if ($bootTask) { 'Update' } else { 'Add' }
  Invoke-Change "$what the task '$BootTaskName': start WSL at startup (nobody signed in), at sign-in, and again within 5 minutes whenever it stops" {
    # A distro is per user, so the task runs as THIS user, without a stored
    # password (S4U).
    $action = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument "-d $Distro -u root -- sleep infinity"
    $triggers = @(
      (New-ScheduledTaskTrigger -AtStartup),
      (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"),
      # No -RepetitionDuration: repeats for as long as the task exists.
      (New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5))
    )
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $BootTaskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Force | Out-Null
  }
}

# Fast Startup makes Shut down a hibernation: the next power-on runs no
# startup task, and the shop finds the app down (#237). Hibernate itself stays.
$powerKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power'
$hiberboot = (Get-ItemProperty -Path $powerKey -Name HiberbootEnabled -ErrorAction SilentlyContinue).HiberbootEnabled
if ($hiberboot -eq 0) {
  Say-Ok 'Fast Startup is off: Shut down really shuts down'
} else {
  Invoke-Change 'Turn off Fast Startup, so Shut down really shuts down and the app starts on the next power-on' {
    Set-ItemProperty -Path $powerKey -Name HiberbootEnabled -Value 0 -Type DWord
  }
}

# Never sleep on mains power: a sleeping server stops the app for every device.
$sleepQuery = (& powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE) -join "`n"
$acSleep = if ($sleepQuery -match 'AC Power Setting Index:\s*0x([0-9a-fA-F]+)') { [Convert]::ToInt32($Matches[1], 16) } else { -1 }
if ($acSleep -eq 0) {
  Say-Ok 'Never sleeps when plugged in'
} else {
  Invoke-Change 'Never sleep when plugged in (sleep and hibernate after: never)' {
    & powercfg /change standby-timeout-ac 0
    & powercfg /change hibernate-timeout-ac 0
  }
}

# --- 6. Apply and report ---------------------------------------------------
if ($script:RestartWsl) {
  Invoke-Change 'Restart WSL so the new settings apply (wsl --shutdown; anything running in WSL stops and starts again)' {
    Invoke-Wsl @('--shutdown') | Out-Null
    Invoke-Wsl @('-d', $Distro, '-u', 'root', '--', 'true') | Out-Null
  }
}

# The task holds WSL open only while it runs. wsl --shutdown above ends it,
# and a new task waits for its first trigger: start it now, or WSL stops when
# this window closes and the app with it (#237).
$bootTask = Get-ScheduledTask -TaskName $BootTaskName -ErrorAction SilentlyContinue
if ($DryRun -and -not $bootTask) {
  $script:Planned.Add("Start the task '$BootTaskName' now, so WSL keeps running when this window closes")
} elseif ($bootTask -and ($script:RestartWsl -or $bootTask.State -ne 'Running')) {
  Invoke-Change "Start the task '$BootTaskName' now, so WSL keeps running when this window closes" {
    Stop-ScheduledTask -TaskName $BootTaskName -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $BootTaskName
  }
}

Write-Host ''
if ($DryRun) {
  if ($script:Planned.Count -eq 0) {
    Write-Host 'Nothing to change: this PC is ready.' -ForegroundColor Green
  } else {
    Write-Host 'Would change:' -ForegroundColor Cyan
    foreach ($item in $script:Planned) { Write-Host "  - $item" }
  }
} elseif ($script:Changed.Count -eq 0) {
  Write-Host 'Nothing to change: this PC is ready.' -ForegroundColor Green
} else {
  Write-Host 'Done. Changed:' -ForegroundColor Green
  foreach ($item in $script:Changed) { Write-Host "  - $item" }
}

# The address phones will use, and the one step a script cannot do.
$address = Invoke-InDistro "hostname -I | awk '{print `$1}'"
if ($address) {
  Write-Host ''
  Write-Host "This PC's address on the shop's network: $address"
  Write-Host 'Reserve it for this PC on the router (DHCP reservation), so phones keep finding it.'
}
