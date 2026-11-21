<#
  Running things in WSL from Windows PowerShell (#211, #133 P3), shared by
  prepare-windows.ps1 and install.ps1. Each trap below was found running the
  scripts on a real PC. Expects $Distro to be set by the script that loads it.
#>

<#
  Runs wsl.exe and returns its standard output; the exit code is in
  $LASTEXITCODE. Its standard error is dropped: with $ErrorActionPreference
  Stop, Windows PowerShell 5.1 turns ANY line a program writes there into a
  terminating error, and WSL writes harmless warnings ("Failed to mount D:\").
#>
function Invoke-Wsl([string[]]$arguments, [string]$inputText = $null) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($null -ne $inputText) { $output = $inputText | & wsl.exe @arguments 2>$null }
    else { $output = & wsl.exe @arguments 2>$null }
  } finally {
    $ErrorActionPreference = $previous
  }
  return $output
}

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

<#
  Runs a command in the distribution as root and returns its output; $null
  when WSL or the distro is not there, or the command failed.

  !! The command goes on STANDARD INPUT, never as an argument. Two traps,
  both found running this on a real PC:
  - Windows PowerShell 5.1 passes an argument holding double quotes to a
    program mangled, so `sh -c "<command>"` ran a cut-off command (the
    Docker repository line would have been broken).
  - after `--`, WSL hands the line to the distro's shell first, which
    expands every `$` early (`awk '{print $1}'` printed the whole line).
  - and a program in the command (apt-get, curl) could read the REST of the
    command as its own input if sh ran it straight from stdin.
  So: --exec (no shell in between), the command saved from stdin to a
  temporary file with Windows' CR line endings removed, then run with no
  input. The runner below holds no double quote, for the first trap.
#>
$DistroRunner = 'f=$(mktemp) && tr -d ''\r'' > $f && sh $f < /dev/null; rc=$?; rm -f $f; exit $rc'
function Invoke-InDistro([string]$command) {
  $output = Invoke-Wsl @('-d', $Distro, '-u', 'root', '--exec', 'sh', '-c', $DistroRunner) ($command -replace "`r", '')
  if ($LASTEXITCODE -ne 0) { return $null }
  return ($output -join "`n")
}

