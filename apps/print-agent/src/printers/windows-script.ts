/**
 * The PowerShell the agent runs to ask Windows what it can print on.
 *
 * A string here rather than a `.ps1` file, so it travels inside the built
 * agent with nothing to copy beside it, and is passed as `-EncodedCommand`,
 * so no file is written and no execution policy applies.
 *
 * What it does, per printer not in `$env:KW_PRINT_EXCLUDE` (a JSON list):
 *   - `Get-Printer` for the name, driver, port and status;
 *   - .NET `PrinterSettings.PaperSizes` for the papers, and a `PageSettings`
 *     with each paper selected for its PRINTABLE AREA — the one number no Node
 *     package reads on Windows (PRINT-STUDIO-PLAN §10, "Packages");
 *   - `DeviceCapabilities` for each paper's EXACT size in tenths of a
 *     millimetre. .NET rounds sizes to hundredths of an inch, which makes A4
 *     210.06 mm wide; the studio compares sizes exactly.
 *
 *   - the driver's PRINT CAPABILITIES (`System.Printing`) for the paper types
 *     and qualities it offers, with the names it shows a person, and the
 *     queue's own print ticket for the one of each it is set to now. These
 *     are the driver's words (`psk:Plain`, `ns0000:HighQuality`), and a job
 *     names them back unchanged (`WINDOWS_TICKET_SCRIPT`).
 *
 * ⚠ A PRINTER THAT THROWS IS STILL LISTED, with no papers: a driver that
 * cannot be asked is a fact worth showing, not a reason to hide the queue.
 * The same for its settings: a driver with no capabilities offers none.
 * ⚠ It only READS. Nothing here changes a printer's settings or sends a job.
 */
export const WINDOWS_PRINTERS_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace Kw -Name Spool -MemberDefinition @'
[DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern int DeviceCapabilities(string device, string port, short capability, IntPtr output, IntPtr devMode);
'@
function Get-ExactPaperSizes([string]$name, [string]$port) {
  $sizes = @{}
  $count = [Kw.Spool]::DeviceCapabilities($name, $port, 2, [IntPtr]::Zero, [IntPtr]::Zero)
  if ($count -le 0) { return $sizes }
  $ids = [Runtime.InteropServices.Marshal]::AllocHGlobal($count * 2)
  $points = [Runtime.InteropServices.Marshal]::AllocHGlobal($count * 8)
  try {
    [void][Kw.Spool]::DeviceCapabilities($name, $port, 2, $ids, [IntPtr]::Zero)
    [void][Kw.Spool]::DeviceCapabilities($name, $port, 3, $points, [IntPtr]::Zero)
    for ($i = 0; $i -lt $count; $i++) {
      $id = [Runtime.InteropServices.Marshal]::ReadInt16($ids, $i * 2)
      $w = [Runtime.InteropServices.Marshal]::ReadInt32($points, $i * 8)
      $h = [Runtime.InteropServices.Marshal]::ReadInt32($points, $i * 8 + 4)
      $sizes[[int]$id] = @($w, $h)
    }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($ids)
    [Runtime.InteropServices.Marshal]::FreeHGlobal($points)
  }
  return $sizes
}
$printing = $true
try { Add-Type -AssemblyName System.Printing, ReachFramework } catch { $printing = $false }
function Get-FeatureOptions($caps, [string]$feature) {
  $options = @()
  foreach ($node in $caps.PrintCapabilities.Feature) {
    if ($node.name -ne $feature) { continue }
    foreach ($option in $node.Option) {
      if (-not $option.name) { continue }
      $label = $null
      foreach ($property in $option.Property) {
        if ($property.name -eq 'psk:DisplayName') { $label = [string]$property.Value.'#text' }
      }
      if (-not $label) { $label = [string]$option.name }
      $options += [pscustomobject]@{ id = [string]$option.name; label = $label }
    }
  }
  return ,$options
}
function Get-TicketChoice($ticket, [string]$feature) {
  foreach ($node in $ticket.PrintTicket.Feature) {
    if ($node.name -eq $feature -and $node.Option.name) { return [string]$node.Option.name }
  }
  return $null
}
function Get-PrinterSettings([string]$name) {
  if (-not $printing) { return $null }
  $server = New-Object System.Printing.LocalPrintServer
  $queue = New-Object System.Printing.PrintQueue($server, $name)
  $caps = [xml](New-Object IO.StreamReader($queue.GetPrintCapabilitiesAsXml())).ReadToEnd()
  $stream = $queue.UserPrintTicket.GetXmlStream()
  $stream.Position = 0
  $ticket = [xml](New-Object IO.StreamReader($stream)).ReadToEnd()
  return [pscustomobject]@{
    mediaTypes = Get-FeatureOptions $caps 'psk:PageMediaType'
    mediaType = Get-TicketChoice $ticket 'psk:PageMediaType'
    qualities = Get-FeatureOptions $caps 'psk:PageOutputQuality'
    quality = Get-TicketChoice $ticket 'psk:PageOutputQuality'
  }
}
$excluded = @()
if ($env:KW_PRINT_EXCLUDE) { $excluded = @(ConvertFrom-Json $env:KW_PRINT_EXCLUDE) }
$default = (New-Object System.Drawing.Printing.PrinterSettings).PrinterName
$result = @()
foreach ($printer in Get-Printer) {
  if ($excluded -contains $printer.Name) { continue }
  $papers = @()
  try {
    $settings = New-Object System.Drawing.Printing.PrinterSettings
    $settings.PrinterName = $printer.Name
    if ($settings.IsValid) {
      $exact = Get-ExactPaperSizes $printer.Name $printer.PortName
      foreach ($paper in $settings.PaperSizes) {
        $page = New-Object System.Drawing.Printing.PageSettings($settings)
        $page.PaperSize = $paper
        $area = $page.PrintableArea
        $size = $exact[[int]$paper.RawKind]
        $papers += [pscustomobject]@{
          name = $paper.PaperName
          kind = [int]$paper.RawKind
          widthTenthsMm = if ($size) { $size[0] } else { $null }
          heightTenthsMm = if ($size) { $size[1] } else { $null }
          widthHundredthsIn = $paper.Width
          heightHundredthsIn = $paper.Height
          area = [pscustomobject]@{ x = $area.X; y = $area.Y; width = $area.Width; height = $area.Height }
        }
      }
    }
  } catch { }
  $printerSettings = $null
  try { $printerSettings = Get-PrinterSettings $printer.Name } catch { }
  $result += [pscustomobject]@{
    name = $printer.Name
    driver = $printer.DriverName
    isDefault = ($printer.Name -eq $default)
    status = [string]$printer.PrinterStatus
    papers = $papers
    settings = $printerSettings
  }
}
ConvertTo-Json -InputObject $result -Depth 6 -Compress
`;

/**
 * The PowerShell that sets a queue's paper type and quality for ONE job, and
 * puts back what was there.
 *
 * ## Why it changes the queue's settings at all
 *
 * The program that prints (SumatraPDF, inside `pdf-to-printer`) takes a paper
 * and a scale and nothing else: it prints with the queue's settings as they
 * stand. A paper type and a quality live in the driver's own data, which only
 * the driver can write, from a PRINT TICKET. So for the moment of one job the
 * agent sets this user's settings for that queue, prints, and restores them.
 *
 * ⚠ THE COST, NAMED (PLAN §12.115). For those few seconds, anything else
 * this Windows user prints on that queue gets the job's settings too. And if
 * the agent is killed between the two steps the queue stays as the job set
 * it, until somebody changes it in Windows or the next job with settings
 * runs. The agent prints one job at a time, so two jobs never overlap here.
 *
 * `KW_PRINT_MODE=apply` writes the settings as they were to
 * `KW_PRINT_TICKET_FILE`, then merges only what the job chose over them and
 * lets the driver validate it. ⚠ THE DRIVER DECIDES THE REST: it picks the
 * resolution that goes with the paper type and quality, and may refuse a
 * pair it does not do (an Epson L110 driver prints plain paper at Standard
 * whatever is asked). The result is printed as JSON, so the agent can say
 * when what it got is not what was asked.
 *
 * `KW_PRINT_MODE=restore` reads that file back and sets it.
 *
 * ⚠ ONLY THE DRIVER'S OWN WORDS REACH THE TICKET. An id is looked up among
 * the options the driver offers now, and the job stops if it is not there.
 */
export const WINDOWS_TICKET_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Printing, ReachFramework
$server = New-Object System.Printing.LocalPrintServer
$queue = New-Object System.Printing.PrintQueue($server, $env:KW_PRINT_PRINTER, [System.Printing.PrintSystemDesiredAccess]::UsePrinter)
function Get-Choice($ticket, [string]$feature) {
  $stream = $ticket.GetXmlStream()
  $stream.Position = 0
  $doc = [xml](New-Object IO.StreamReader($stream)).ReadToEnd()
  foreach ($node in $doc.PrintTicket.Feature) {
    if ($node.name -eq $feature -and $node.Option.name) { return [string]$node.Option.name }
  }
  return $null
}
if ($env:KW_PRINT_MODE -eq 'restore') {
  $file = [IO.File]::OpenRead($env:KW_PRINT_TICKET_FILE)
  try { $queue.UserPrintTicket = New-Object System.Printing.PrintTicket($file) } finally { $file.Dispose() }
  $queue.Commit()
  'restored'
  return
}
$file = [IO.File]::Create($env:KW_PRINT_TICKET_FILE)
try { $queue.UserPrintTicket.SaveTo($file) } finally { $file.Dispose() }
$caps = [xml](New-Object IO.StreamReader($queue.GetPrintCapabilitiesAsXml())).ReadToEnd()
$wanted = @{}
if ($env:KW_PRINT_MEDIA) { $wanted['psk:PageMediaType'] = $env:KW_PRINT_MEDIA }
if ($env:KW_PRINT_QUALITY) { $wanted['psk:PageOutputQuality'] = $env:KW_PRINT_QUALITY }
$namespaces = @{}
$features = ''
foreach ($feature in $wanted.Keys) {
  $id = $wanted[$feature]
  $offered = $false
  foreach ($node in $caps.PrintCapabilities.Feature) {
    if ($node.name -ne $feature) { continue }
    foreach ($option in $node.Option) { if ($option.name -eq $id) { $offered = $true } }
  }
  if (-not $offered) { throw "This printer does not offer '$id' any more." }
  $prefix = $id.Split(':')[0]
  $namespaces[$prefix] = $caps.DocumentElement.GetNamespaceOfPrefix($prefix)
  $features += "<psf:Feature name='$feature'><psf:Option name='$id'/></psf:Feature>"
}
$declared = "xmlns:psf='http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework' xmlns:psk='http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords'"
foreach ($prefix in $namespaces.Keys) {
  if ($prefix -ne 'psf' -and $prefix -ne 'psk') { $declared += " xmlns:$prefix='" + $namespaces[$prefix] + "'" }
}
$bytes = [Text.Encoding]::UTF8.GetBytes("<psf:PrintTicket $declared version='1'>$features</psf:PrintTicket>")
$delta = New-Object System.Printing.PrintTicket((New-Object IO.MemoryStream(,$bytes)))
$merged = $queue.MergeAndValidatePrintTicket($queue.UserPrintTicket, $delta)
$queue.UserPrintTicket = $merged.ValidatedPrintTicket
$queue.Commit()
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{
  mediaType = Get-Choice $merged.ValidatedPrintTicket 'psk:PageMediaType'
  quality = Get-Choice $merged.ValidatedPrintTicket 'psk:PageOutputQuality'
})
`;
