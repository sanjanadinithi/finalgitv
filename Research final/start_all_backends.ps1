# =========================================================================
# Sentinel AIOps - SRE Command Center: Full Stack Launcher (PowerShell)
# Launches all backend microservices, ML predictors, and the UI
# =========================================================================

$Root = $PSScriptRoot
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Sentinel AIOps - SRE Command Center (Windows Stack)" -ForegroundColor Cyan
Write-Host "  Root: $Root" -ForegroundColor DarkGray
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Component 1: Log/Metrics Ingestion Pipeline (FastAPI :8001)
#    Launched through component1's own launcher script so it picks up the
#    same interpreter/venv logic as running it standalone.
Write-Host "`n[1/7] Starting Component 1 (Ingestion Pipeline on port 8001)..." -ForegroundColor Yellow
$Comp1 = Join-Path $Root "component1"
$Comp1Bat = Join-Path $Comp1 "run_component1_ui.bat"
if (Test-Path $Comp1Bat) {
    Start-Process cmd -ArgumentList "/c", "`"$Comp1Bat`""
    Write-Host "      -> Component 1 launched via run_component1_ui.bat (UI: http://localhost:8001/)" -ForegroundColor Green
} elseif (Test-Path (Join-Path $Comp1 "app.py")) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='COMP1 - Ingestion API :8001'; Set-Location '$Comp1'; python -m uvicorn app:app --host 0.0.0.0 --port 8001 --reload"
    Write-Host "      -> Component 1 API launched on http://localhost:8001/docs" -ForegroundColor Green
} else {
    Write-Host "      -> SKIP: component1 not found" -ForegroundColor DarkYellow
}

# 2. Component 2: Local Microservices with Sidecars (ports 5001-5005)
Write-Host "`n[2/7] Starting Component 2 (Microservices on ports 5001-5005)..." -ForegroundColor Yellow
$C2 = Join-Path $Root "c2\Queue-Aware CPU Spike Analyzer\research_framework"
if (Test-Path (Join-Path $C2 "run_local_services.py")) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='COMP2 - Local Services :5001-5005'; Set-Location '$C2'; python run_local_services.py"
    Write-Host "      -> 5 Microservices launched on ports 5001-5005" -ForegroundColor Green
} else {
    Write-Host "      -> SKIP: run_local_services.py not found" -ForegroundColor DarkYellow
}

# 3. Component 2: Queue-Aware CPU Spike Analyzer console (:8081)
#    Serves the c2 React frontend (frontend/dist) + its /api endpoints.
Write-Host "`n[3/7] Starting Component 2 (CPU Spike Analyzer Console on port 8081)..." -ForegroundColor Yellow
if (Test-Path (Join-Path $C2 "realtime_experiment.py")) {
    # Prefer the c2 venv only if it actually runs (the venv may point to a
    # deleted interpreter); otherwise fall back to the system python.
    $C2Venv = Join-Path $C2 "venv\Scripts\python.exe"
    $C2Py = "python"
    if (Test-Path $C2Venv) {
        try { & $C2Venv --version *> $null; if ($LASTEXITCODE -eq 0) { $C2Py = "'$C2Venv'" } } catch { }
    }
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='COMP2 - CPU Analyzer Console :8081'; Set-Location '$C2'; & $C2Py realtime_experiment.py"
    Write-Host "      -> CPU Spike Analyzer console running on http://localhost:8081" -ForegroundColor Green
} else {
    Write-Host "      -> SKIP: realtime_experiment.py not found" -ForegroundColor DarkYellow
}

# 4. Component 3: MUP / Memory Leak Predictor (Live Simulator + optional Flask :5003)
Write-Host "`n[4/7] Starting Component 3 (MUP Memory Predictor)..." -ForegroundColor Yellow
$Mup = Join-Path $Root "MUP"
# data/ holds the git-ignored live feeds that Component 4 and the gateway read.
New-Item -ItemType Directory -Force -Path (Join-Path $Mup "data") | Out-Null
if (-not (Test-Path (Join-Path $Mup "models\memory_leak_rf_model.pkl"))) {
    Write-Host "      -> WARNING: models\memory_leak_rf_model.pkl is missing."
    Write-Host "         Run 'cd MUP; python scripts/train_model.py' or MUP\start.bat,"
    Write-Host "         otherwise every memory_prob reaching Component 4 is 0.0000."
}
if (Test-Path (Join-Path $Mup "scripts\simulate_live.py")) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='COMP3 - Live Simulator'; Set-Location '$Mup'; python scripts/simulate_live.py"
    Write-Host "      -> MUP Live Simulator started" -ForegroundColor Green
}
if (Test-Path (Join-Path $Mup "dashboard\app.py")) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='COMP3 - Flask Dashboard :5003'; Set-Location '$Mup'; python dashboard/app.py"
    Write-Host "      -> MUP Dashboard started on http://localhost:5003" -ForegroundColor Green
}

# 5. Component 4: CPU Spike Predictor (FastAPI :8000 + Live Inference Engine)
Write-Host "`n[5/7] Starting Component 4 (CPU Spike Predictor)..." -ForegroundColor Yellow
$Cpu = Join-Path $Root "cpu_spike_predictor"
if (Test-Path (Join-Path $Cpu "src\api.py")) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='COMP4 - CPU Predictor API :8000'; Set-Location '$Cpu'; python -m uvicorn src.api:app --host 0.0.0.0 --port 8000 --reload"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='COMP4 - Live Inference Engine'; Set-Location '$Cpu'; python -m src.live_inference"
    Write-Host "      -> Component 4 API & Live Inference launched on http://localhost:8000/docs" -ForegroundColor Green
}

# 6. Dashboard Gateway (port 8766) — serves BOTH the API and the built React UI
Write-Host "`n[6/7] Starting SRE Command Center (Gateway + UI :8766)..." -ForegroundColor Yellow
$Dash = Join-Path $Root "Dashboard"
if (Test-Path (Join-Path $Dash "server.py")) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='DASHBOARD - Gateway + UI :8766'; Set-Location '$Dash'; python server.py"
    Write-Host "      -> Dashboard (API + UI) running on http://localhost:8766/" -ForegroundColor Green
}
# Optional: Vite dev server (hot reload) for UI development only. The gateway
# already serves dashboard-ui/dist on :8766, so this is NOT required to use the
# dashboard. If it is closed, the dashboard still works at http://localhost:8766.
$Ui = Join-Path $Dash "dashboard-ui"
if (Test-Path (Join-Path $Ui "package.json")) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle='DASHBOARD - Vite Dev (optional) :5173'; Set-Location '$Ui'; npm run dev"
    Write-Host "      -> (optional dev) Vite UI on http://localhost:5173" -ForegroundColor DarkGreen
}

# 7. Open Browser
Write-Host "`n[7/7] Opening Browser Interfaces..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
Start-Process "http://localhost:8766"
Start-Process "c:\Users\ASUS\Desktop\final p2\sre_research_poster.html"

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  ALL SYSTEMS RUNNING!" -ForegroundColor Green
Write-Host "  React SRE Command Center :  http://localhost:8766" -ForegroundColor White
Write-Host "  CPU Spike Analyzer Console:  http://localhost:8081" -ForegroundColor White
Write-Host "  Academic Research Poster :  c:\Users\ASUS\Desktop\final p2\sre_research_poster.html" -ForegroundColor White
Write-Host "  Component 4 Predictor API:  http://localhost:8000/docs" -ForegroundColor White
Write-Host "  Component 1 Ingest API   :  http://localhost:8001/docs" -ForegroundColor White
Write-Host "  Component 3 MUP Dashboard:  http://localhost:5003" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Cyan
