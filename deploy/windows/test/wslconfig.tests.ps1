<#
  Tests for lib\wslconfig.ps1 (#211): powershell -ExecutionPolicy Bypass -File .\test\wslconfig.tests.ps1
  Exits 1 on the first failure, naming it.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\lib\wslconfig.ps1')
$wanted = [ordered]@{ networkingMode = 'mirrored'; vmIdleTimeout = '-1' }
$failures = 0

function Check([string]$name, [string[]]$given, [string[]]$expected) {
  $actual = Set-WslConfigValues $given $wanted
  if (($actual -join "`n") -ceq ($expected -join "`n")) {
    Write-Host "  [ok] $name"
  } else {
    Write-Host "  [xx] $name" -ForegroundColor Red
    Write-Host ('       expected: ' + ($expected -join ' | '))
    Write-Host ('       actual:   ' + ($actual -join ' | '))
    $script:failures += 1
  }
}

Check 'an empty file gets the section' @() @('[wsl2]', 'networkingMode=mirrored', 'vmIdleTimeout=-1')
Check 'other settings and comments are kept; missing keys added at the end of [wsl2]' `
  @('# mine', '[wsl2]', 'memory=6GB', '', '[experimental]', 'autoMemoryReclaim=gradual') `
  @('# mine', '[wsl2]', 'memory=6GB', '', 'networkingMode=mirrored', 'vmIdleTimeout=-1', '[experimental]', 'autoMemoryReclaim=gradual')
Check 'a wrong value is replaced in place' `
  @('[wsl2]', 'networkingMode=nat', 'memory=6GB') `
  @('[wsl2]', 'networkingMode=mirrored', 'memory=6GB', 'vmIdleTimeout=-1')
Check 'no [wsl2] section: added after the others' `
  @('[experimental]', 'sparseVhd=true') `
  @('[experimental]', 'sparseVhd=true', '[wsl2]', 'networkingMode=mirrored', 'vmIdleTimeout=-1')
Check 'already right: unchanged' `
  @('[wsl2]', 'networkingMode=mirrored', 'vmIdleTimeout=-1') `
  @('[wsl2]', 'networkingMode=mirrored', 'vmIdleTimeout=-1')
Check 'a key repeated: one line left' `
  @('[wsl2]', 'networkingMode=nat', 'networkingMode=nat') `
  @('[wsl2]', 'networkingMode=mirrored', 'vmIdleTimeout=-1')

$value = Get-WslConfigValue @('[other]', 'networkingMode=nat', '[wsl2]', ' networkingMode = mirrored ') 'networkingMode'
if ($value -eq 'mirrored') { Write-Host '  [ok] reads the [wsl2] value, not another section''s' } else { Write-Host "  [xx] read '$value'"; $failures += 1 }

if ($failures -gt 0) { exit 1 }
Write-Host 'All passed.'
