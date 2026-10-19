Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Starting Microservices 1-10 in Docker" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $baseDir

Write-Host "[1/3] Building Docker images..." -ForegroundColor Yellow
docker compose build

Write-Host ""
Write-Host "[2/3] Starting containers..." -ForegroundColor Yellow
docker compose up -d

Write-Host ""
Write-Host "[3/3] Verifying services..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

$services = @(
    @{Name = "Microservice 01 (Node.js)"; Port = 3001 },
    @{Name = "Microservice 02 (Python)"; Port = 3002 },
    @{Name = "Microservice 03 (Java)"; Port = 3003 },
    @{Name = "Microservice 04 (Go)"; Port = 3004 },
    @{Name = "Microservice 05 (Ruby)"; Port = 3005 },
    @{Name = "Microservice 06 (PHP)"; Port = 3006 },
    @{Name = "Microservice 07 (C#)"; Port = 3007 },
    @{Name = "Microservice 08 (Rust)"; Port = 3008 },
    @{Name = "Microservice 09 (Kotlin)"; Port = 3009 },
    @{Name = "Microservice 10 (Scala)"; Port = 3010 }
)

Write-Host ""
Write-Host "Service URLs:" -ForegroundColor Green
Write-Host "-------------" -ForegroundColor Green
foreach ($svc in $services) {
    Write-Host "  $($svc.Name): http://localhost:$($svc.Port)/"
    Write-Host "    Ping:    http://localhost:$($svc.Port)/ping"
    Write-Host "    Metrics: http://localhost:$($svc.Port)/metrics"
    Write-Host ""
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Useful commands:" -ForegroundColor Cyan
Write-Host "    View logs:    docker compose logs -f" -ForegroundColor Gray
Write-Host "    Status:       docker compose ps" -ForegroundColor Gray
Write-Host "    Stop all:     docker compose down" -ForegroundColor Gray
Write-Host "    Stop + clean: docker compose down -v" -ForegroundColor Gray
Write-Host "============================================" -ForegroundColor Cyan
