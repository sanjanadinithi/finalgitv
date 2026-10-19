# ============================================================
# run_synthetic_test.ps1
# Starts 5 synthetic sidecar servers (different stacks &
# failure modes) then launches the Component 1 pipeline
# in LIVE mode against them — no real Azure needed.
# ============================================================

param(
    [int]$DurationMinutes = 0,
    [string]$PythonExe = "python"
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

# ── Sidecar definitions ──────────────────────────────────────
# Each entry: port, realistic service name, stack language, failure mode
# Purely memory-focused failure modes: memory_leak | oom | gc_overhead | mixed
$Sidecars = @(
    @{ Port = 8080; Name = "payment-service";     Stack = "python"; Failure = "mixed"       },
    @{ Port = 8081; Name = "user-api";            Stack = "node";   Failure = "memory_leak" },
    @{ Port = 8082; Name = "order-processor";     Stack = "go";     Failure = "memory_leak" },
    @{ Port = 8083; Name = "inventory-service";   Stack = "java";   Failure = "gc_overhead" },
    @{ Port = 8084; Name = "notification-worker"; Stack = "ruby";   Failure = "oom"         }
)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " SYNTHETIC TEST - Component 1 (no Azure required)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
if ($DurationMinutes -gt 0) {
    Write-Host " Duration : $DurationMinutes minute(s)" -ForegroundColor Yellow
} else {
    Write-Host " Duration : Continuous / Live (Press Ctrl+C to stop)" -ForegroundColor Yellow
}
Write-Host ""

# ── 0. Kill any stale processes on our ports ─────────────────
$AllPorts = ($Sidecars | ForEach-Object { $_.Port }) + 8001
Write-Host " Clearing ports $($AllPorts -join ', ')..." -ForegroundColor DarkGray
foreach ($p in $AllPorts) {
    $procIds = netstat -ano 2>$null |
        Select-String ":$p\s" |
        ForEach-Object { ($_ -split '\s+') | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1 } |
        Sort-Object -Unique
    foreach ($procId in $procIds) {
        if ($procId -and $procId -ne '0') {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
}
Start-Sleep -Milliseconds 500
Write-Host " Ports cleared." -ForegroundColor DarkGray
Write-Host ""

# ── 1. Start mock sidecar processes ─────────────────────────
$SidecarJobs = @()
foreach ($sc in $Sidecars) {
    Write-Host (" Starting  {0,-22}  port={1,-5}  stack={2,-8}  failure={3}" -f $sc.Name, $sc.Port, $sc.Stack, $sc.Failure) -ForegroundColor Green
    $job = Start-Process -FilePath $PythonExe `
        -ArgumentList "mock_azure_sidecar.py", "--port", $sc.Port, "--name", $sc.Name, "--stack", $sc.Stack, "--failure", $sc.Failure `
        -WorkingDirectory $Root `
        -PassThru `
        -WindowStyle Hidden
    $SidecarJobs += $job
}

Write-Host ""
Write-Host " Waiting 2 s for sidecars to bind their ports..." -ForegroundColor DarkGray
Start-Sleep -Seconds 2

# ── 2. Verify sidecars are reachable ────────────────────────
Write-Host ""
Write-Host " Verifying sidecar /ping endpoints:" -ForegroundColor Yellow
foreach ($sc in $Sidecars) {
    $url = "http://127.0.0.1:$($sc.Port)/ping"
    try {
        $resp = Invoke-RestMethod -Uri $url -TimeoutSec 3
        Write-Host ("   OK  {0,-22}  port {1}  => status={2}" -f $sc.Name, $sc.Port, $resp.status) -ForegroundColor Green
    } catch {
        Write-Host ("   FAIL  {0,-22}  port {1}  => UNREACHABLE" -f $sc.Name, $sc.Port) -ForegroundColor Red
    }
}

Write-Host ""
Write-Host " Starting main pipeline (PIPELINE_MODE=live) ..." -ForegroundColor Cyan
Write-Host " Press Ctrl+C to stop early." -ForegroundColor DarkGray
Write-Host ""

# ── 3. Run the main FastAPI app ──────────────────────────────
$env:PIPELINE_MODE             = "live"
$env:PIPELINE_DURATION_MINUTES = "$DurationMinutes"

try {
    & $PythonExe -m uvicorn app:app --host 127.0.0.1 --port 8001
} finally {
    # ── 4. Cleanup: kill all sidecar processes ───────────────
    Write-Host ""
    Write-Host " Stopping sidecar processes..." -ForegroundColor Yellow
    foreach ($job in $SidecarJobs) {
        if (-not $job.HasExited) {
            Stop-Process -Id $job.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host " All sidecars stopped. Done." -ForegroundColor Green
}
