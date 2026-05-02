# =============================================================
# ERP Loga - Desinstalar (Windows)
# =============================================================
# Por defecto: quita la tarea programada y mata procesos
# (modo "soft", conserva BD, node_modules, etc).
#
# Con -All: BORRA TODO. Ideal para reinstalar limpio:
#   - Tarea programada ERPLoga
#   - Procesos node en 3001 / 4173
#   - Servicio Windows  postgresql-loga
#   - Carpeta           C:\LogaERP\  (binarios PG y datos)
#   - Carpetas          backend\node_modules, backend\dist, backend\.env
#                       backend\uploads, backend\backups
#                       frontend\node_modules, frontend\dist, frontend\.env
#                       logs\
# =============================================================

param(
    [switch]$All
)

$ErrorActionPreference = "Continue"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step($m) { Write-Host "[*] $m" -ForegroundColor Blue }
function Write-Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "[!] $m" -ForegroundColor Yellow }

$TaskName = "ERPLoga"
$PgServiceName = "postgresql-loga"
$PgInstallDir = "C:\LogaERP"

# ===== Modo soft (siempre se ejecuta) =====

Write-Step "Quitando tarea programada '$TaskName'..."
schtasks /query /tn $TaskName 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    schtasks /delete /tn $TaskName /f | Out-Null
    Write-Ok "Tarea eliminada"
} else {
    Write-Ok "No habia tarea instalada"
}

Write-Step "Matando procesos node en 3001 y 4173..."
function Stop-Port($port) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
Stop-Port 3001
Stop-Port 4173
# Matar tambien cualquier start.ps1 huerfano
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*start.ps1*"
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Ok "Procesos parados"

if (-not $All) {
    Write-Host ""
    Write-Host "Modo soft: BD, node_modules y PostgreSQL DEDICADO conservados."
    Write-Host "Para borrar TODO y empezar desde cero:  uninstall-all.bat"
    exit 0
}

# ===== Modo -All: borrar todo =====
Write-Host ""
Write-Warn "Modo -All: BORRANDO TODO"

# Servicio PostgreSQL DEDICADO
if (Get-Service $PgServiceName -ErrorAction SilentlyContinue) {
    Write-Step "Parando y eliminando servicio '$PgServiceName'..."
    Stop-Service $PgServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    & sc.exe delete $PgServiceName | Out-Null
    Start-Sleep -Seconds 2
    Write-Ok "Servicio eliminado"
}

# Carpeta C:\LogaERP (binarios PG + cluster)
if (Test-Path $PgInstallDir) {
    Write-Step "Borrando $PgInstallDir..."
    Remove-Item $PgInstallDir -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $PgInstallDir) {
        Write-Warn "$PgInstallDir no se pudo borrar entero (algun fichero bloqueado). Reintenta tras reiniciar."
    } else {
        Write-Ok "$PgInstallDir eliminado"
    }
}

# Backend
$pathsBackend = @(
    "$ProjectDir\backend\node_modules",
    "$ProjectDir\backend\dist",
    "$ProjectDir\backend\.env",
    "$ProjectDir\backend\uploads",
    "$ProjectDir\backend\backups"
)
foreach ($p in $pathsBackend) {
    if (Test-Path $p) {
        Write-Step "Borrando $p..."
        Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Frontend
$pathsFrontend = @(
    "$ProjectDir\frontend\node_modules",
    "$ProjectDir\frontend\dist",
    "$ProjectDir\frontend\.env"
)
foreach ($p in $pathsFrontend) {
    if (Test-Path $p) {
        Write-Step "Borrando $p..."
        Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Logs y password file
foreach ($p in @("$ProjectDir\logs", "$ProjectDir\.postgres_password.txt")) {
    if (Test-Path $p) {
        Write-Step "Borrando $p..."
        Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Ok "Limpieza completa. El sistema esta como antes de install.bat."
Write-Host "Para reinstalar desde cero:"
Write-Host "  install.bat   (clic derecho > Ejecutar como administrador)"
