param(
  [string]$ProxyUrl = "",
  [int]$Batch = 0,
  [string]$ExtZip = "",
  [switch]$NoRotate
)

$ErrorActionPreference = "Stop"

# ---- defaults from env ----
if (-not $ProxyUrl) { $ProxyUrl = $env:PROXY_URL }
if (-not $ProxyUrl) { $ProxyUrl = "http://testuser:testpass@127.0.0.1:1080" }
if ($Batch -le 0) {
  if ($env:ORCH_BATCH) { [int]$Batch = [int]$env:ORCH_BATCH } else { $Batch = 1 }
}

$Root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bundle = Join-Path $Root "antig-orchestrator-mac"

Write-Host "== fast-astro (Windows) ==" -ForegroundColor Cyan
Write-Host "root: $Root"

# ---- proxy config ----
$proxyPath = Join-Path $Root "proxy.astro.json"
$cfg = [ordered]@{
  url            = $ProxyUrl
  ipApiBase      = ""
  ipApiKey       = ""
  pollTimeoutMs  = 180000
  pollIntervalMs = 15000
  tetherIp       = ""
}
($cfg | ConvertTo-Json) | Set-Content -Encoding ASCII $proxyPath
Write-Host "proxy: $ProxyUrl"

# ---- curl check (Windows 10 1803+ ships curl.exe) ----
$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $curl) { $curl = Get-Command curl -ErrorAction SilentlyContinue }
if (-not $curl) {
  Write-Host "WARNING: curl.exe not found. The orchestrator needs it (Windows 10 1803+ has it in C:\Windows\System32)." -ForegroundColor Yellow
}

# ---- node runtime ----
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = $null
if ($nodeCmd) { $nodeExe = $nodeCmd.Source }
if (-not $nodeExe) {
  $nodeDir = Join-Path $Root "runtime\node-win"
  $nodeExe = Join-Path $nodeDir "node.exe"
  if (-not (Test-Path $nodeExe)) {
    Write-Host "downloading Node.js (one time)..."
    $ver = "v20.19.0"
    $zip = Join-Path $env:TEMP "node-$ver-win-x64.zip"
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip" -OutFile $zip
    if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
    New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
    Expand-Archive -Path $zip -DestinationPath $nodeDir -Force
    $inner = Get-ChildItem $nodeDir -Directory | Select-Object -First 1
    if ($inner) {
      Get-ChildItem $inner.FullName | Move-Item -Destination $nodeDir -Force
      Remove-Item -Recurse -Force $inner.FullName
    }
  }
}
Write-Host "node: $nodeExe"

# ---- Octo Browser API check ----
$octoPortFile = Join-Path $env:USERPROFILE ".Octo Browser\local_port"
$octoPort = 58888
if (Test-Path $octoPortFile) {
  try { $octoPort = (Get-Content $octoPortFile -Raw).Trim() } catch {}
}
$octoOk = $false
try {
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 "http://127.0.0.1:$octoPort/api/profiles/active" | Out-Null
  $octoOk = $true
} catch {}
if ($octoOk) {
  Write-Host "Octo API: ok (port $octoPort)" -ForegroundColor Green
} else {
  Write-Host "WARNING: Octo API not reachable on 127.0.0.1:$octoPort." -ForegroundColor Yellow
  Write-Host "         Install Octo Browser, open it, and log in, then re-run." -ForegroundColor Yellow
}

# ---- extension zip (keep original TOS = 1.0.21 if present) ----
if (-not $ExtZip) {
  $c21 = Join-Path $Bundle "gcp-combo-portal-v1.0.21.zip"
  $c39 = Join-Path $Bundle "gcp-combo-portal-v1.0.39.zip"
  if (Test-Path $c21) { $ExtZip = $c21 }
  elseif (Test-Path $c39) { $ExtZip = $c39 }
}
if (-not $ExtZip -or -not (Test-Path $ExtZip)) {
  Write-Host "ERROR: extension zip not found in $Bundle (gcp-combo-portal-v*.zip)." -ForegroundColor Red
  exit 1
}
Write-Host "extension: $ExtZip"

# ---- env ----
$env:ORCH_BATCH               = "$Batch"
$env:ORCH_MAX_RUNS            = "0"
$env:ORCH_RESET_PROFILES      = "1"
$env:ORCH_COMBO               = "1"
$env:ORCH_HID_TOS             = "0"   # Windows: no macOS HID; TOS handled by the extension
$env:ANTIG_REQUIRE_USB_TETHER = "0"
$env:ANTIG_PROXY_CONFIG       = $proxyPath
$env:ORCH_PROXY_CONFIG        = $proxyPath
$env:EXT_ZIP                  = $ExtZip
if (-not $env:ORCH_BATCH_COOLDOWN_MS) { $env:ORCH_BATCH_COOLDOWN_MS = "10000" }
if (-not $env:ANTIG_LOG_ROOT) { $env:ANTIG_LOG_ROOT = Join-Path $env:USERPROFILE "Desktop\antig-logs" }
if ($NoRotate) {
  $env:ORCH_ROTATE_IP = "0"
} else {
  if (-not $env:ORCH_ROTATE_IP)  { $env:ORCH_ROTATE_IP = "1" }
  if (-not $env:ORCH_ROTATE_URL) { $env:ORCH_ROTATE_URL = "http://rotate.local" }
}
New-Item -ItemType Directory -Force -Path $env:ANTIG_LOG_ROOT | Out-Null

Write-Host ""
Write-Host "== starting (batch=$Batch, rotate=$($env:ORCH_ROTATE_IP)) ==" -ForegroundColor Cyan
Write-Host "logs: $env:ANTIG_LOG_ROOT"
Set-Location $Bundle
& $nodeExe "orchestrator.mjs"
