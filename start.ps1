# =============================================================
# ERP Loga — Arranque (Windows)
# =============================================================
# Lanza backend (Node) y frontend (serve). Si uno cae, lo relanza.
# Lo invoca la tarea programada al iniciar sesión.
# =============================================================

$ErrorActionPreference = "Continue"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

New-Item -ItemType Directory -Force -Path "$ProjectDir\logs" | Out-Null

# Asegurar PostgreSQL corriendo
$pgService = Get-Service postgresql-16 -ErrorAction SilentlyContinue
if ($pgService -and $pgService.Status -ne "Running") {
    Start-Service postgresql-16 -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 5
}

function Start-Backend {
    Push-Location "$ProjectDir\backend"
    $proc = Start-Process node -ArgumentList "dist\index.js" `
        -RedirectStandardOutput "$ProjectDir\logs\backend.log" `
        -RedirectStandardError "$ProjectDir\logs\backend.err.log" `
        -PassThru -WindowStyle Hidden
    Pop-Location
    return $proc
}

function Start-Frontend {
    Push-Location "$ProjectDir\frontend"
    $proc = Start-Process npx -ArgumentList "serve","-s","dist","-l","4173","--no-clipboard" `
        -RedirectStandardOutput "$ProjectDir\logs\frontend.log" `
        -RedirectStandardError "$ProjectDir\logs\frontend.err.log" `
        -PassThru -WindowStyle Hidden
    Pop-Location
    return $proc
}

$backend = Start-Backend
$frontend = Start-Frontend

# Bucle keep-alive: si alguno muere, lo relanza
while ($true) {
    Start-Sleep -Seconds 10
    if ($backend.HasExited) {
        Write-Output "$(Get-Date) backend caído (exit=$($backend.ExitCode)), relanzando..." | Out-File -Append "$ProjectDir\logs\watchdog.log"
        $backend = Start-Backend
    }
    if ($frontend.HasExited) {
        Write-Output "$(Get-Date) frontend caído (exit=$($frontend.ExitCode)), relanzando..." | Out-File -Append "$ProjectDir\logs\watchdog.log"
        $frontend = Start-Frontend
    }
}
