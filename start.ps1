# =============================================================
# ERP Loga - Arranque (Windows)
# =============================================================
# Idempotente: si los puertos 3001/4173 ya estan en uso, asume que
# el ERP ya corre (ej. levantado por la tarea programada AtLogon)
# y sale sin relanzar. Asi start.bat se puede ejecutar varias veces
# sin disparar bucles infinitos por EADDRINUSE.
# =============================================================

$ErrorActionPreference = "Continue"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

New-Item -ItemType Directory -Force -Path "$ProjectDir\logs" | Out-Null

function Test-PortInUse($port) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $conn)
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
    # Llamamos a serve con `node serve\build\main.js` en lugar de `npx serve`
    # porque Start-Process npx en Windows spawns un .cmd intermedio que
    # termina inmediatamente y deja serve sin arrancar.
    $serveJs = "$ProjectDir\frontend\node_modules\serve\build\main.js"
    if (-not (Test-Path $serveJs)) {
        "$(Get-Date) ERROR: $serveJs no existe. Ejecuta install.bat de nuevo." | Out-File -Append -Encoding UTF8 "$ProjectDir\logs\watchdog.log"
        return $null
    }
    Push-Location "$ProjectDir\frontend"
    $proc = Start-Process node -ArgumentList $serveJs,"-s","dist","-l","4173","--no-clipboard" `
        -RedirectStandardOutput "$ProjectDir\logs\frontend.log" `
        -RedirectStandardError "$ProjectDir\logs\frontend.err.log" `
        -PassThru -WindowStyle Hidden
    Pop-Location
    return $proc
}

# Si AMBOS puertos ya estan ocupados, ERP ya corre. Salir limpio.
if ((Test-PortInUse 3001) -and (Test-PortInUse 4173)) {
    "$(Get-Date) ERP ya esta corriendo (3001 y 4173 en uso). Nada que hacer." | Out-File -Append -Encoding UTF8 "$ProjectDir\logs\watchdog.log"
    exit 0
}

# Arrancar solo lo que falte
$backend  = if (Test-PortInUse 3001) { $null } else { Start-Backend }
$frontend = if (Test-PortInUse 4173) { $null } else { Start-Frontend }

# Dar margen al primer arranque antes de empezar a vigilar
Start-Sleep -Seconds 5

# Bucle keep-alive: relanza solo si el proceso murio Y el puerto esta libre
# (asi no relanzamos por encima de un proceso ajeno que ocupe el puerto).
while ($true) {
    Start-Sleep -Seconds 10
    if ($backend -and $backend.HasExited -and -not (Test-PortInUse 3001)) {
        "$(Get-Date) backend caido (exit=$($backend.ExitCode)), relanzando..." | Out-File -Append -Encoding UTF8 "$ProjectDir\logs\watchdog.log"
        $backend = Start-Backend
    }
    if ($frontend -and $frontend.HasExited -and -not (Test-PortInUse 4173)) {
        "$(Get-Date) frontend caido (exit=$($frontend.ExitCode)), relanzando..." | Out-File -Append -Encoding UTF8 "$ProjectDir\logs\watchdog.log"
        $frontend = Start-Frontend
    }
}
