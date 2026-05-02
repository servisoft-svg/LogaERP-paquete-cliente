# =============================================================
# ERP Loga — Parar servicio (Windows)
# =============================================================

# 1. Matar la tarea del watchdog (start.ps1) para que no relance
Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -eq "" -and $_.CommandLine -like "*start.ps1*"
} | Stop-Process -Force -ErrorAction SilentlyContinue

# 2. Matar procesos por puerto
function Stop-Port($port) {
    $netstatLines = netstat -ano | Select-String ":$port "
    foreach ($line in $netstatLines) {
        $tokens = $line.ToString().Split() | Where-Object { $_ -ne "" }
        $procId = $tokens[-1]
        if ($procId -match "^\d+$") {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
}
Stop-Port 3001
Stop-Port 4173

Write-Host "ERP Loga parado."
Write-Host "Para volver a arrancarlo:"
Write-Host "  .\start.bat                 (sin auto-arranque)"
Write-Host "  schtasks /run /tn ERPLoga   (arranca la tarea)"
