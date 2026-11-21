<#
  Reading and editing %USERPROFILE%\.wslconfig (#211). Its own file so the
  edit, which rewrites a person's settings, is tested on sample files
  (test\wslconfig.tests.ps1) rather than trusted.
#>

<# The value of $key under [wsl2], or $null. #>
function Get-WslConfigValue([string[]]$content, [string]$key) {
  $inSection = $false
  foreach ($line in $content) {
    if ($line -match '^\s*\[(.+)\]\s*$') { $inSection = ($Matches[1].Trim() -eq 'wsl2'); continue }
    if ($inSection -and $line -match "^\s*$key\s*=\s*(.*?)\s*$") { return $Matches[1] }
  }
  return $null
}

<#
  $content with every key of $wanted set under [wsl2]: a key already there
  is replaced in place, a missing one is added at the end of that section,
  and a missing section is added at the end of the file. Every other line,
  comment and section is kept as it was.
#>
function Set-WslConfigValues([string[]]$content, [System.Collections.IDictionary]$wanted) {
  $out = New-Object System.Collections.Generic.List[string]
  $inSection = $false
  $seenSection = $false
  $done = @{}
  $flush = {
    foreach ($key in $wanted.Keys) {
      if (-not $done[$key]) { $out.Add("$key=$($wanted[$key])"); $done[$key] = $true }
    }
  }
  foreach ($line in $content) {
    if ($line -match '^\s*\[(.+)\]\s*$') {
      if ($inSection) { & $flush }
      $inSection = ($Matches[1].Trim() -eq 'wsl2')
      if ($inSection) { $seenSection = $true }
      $out.Add($line)
      continue
    }
    $replaced = $false
    if ($inSection) {
      foreach ($key in $wanted.Keys) {
        if ($line -match "^\s*$key\s*=") {
          if (-not $done[$key]) { $out.Add("$key=$($wanted[$key])"); $done[$key] = $true }
          $replaced = $true
        }
      }
    }
    if (-not $replaced) { $out.Add($line) }
  }
  if ($inSection) { & $flush }
  if (-not $seenSection) {
    $out.Add('[wsl2]')
    & $flush
  }
  return , $out.ToArray()
}
