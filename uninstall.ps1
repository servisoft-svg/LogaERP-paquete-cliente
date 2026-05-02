# =============================================================
# ERP Loga — Desinstalar arranque automático (Windows)
# =============================================================
# Quita la tarea programada y mata los procesos.
# NO borra el proyecto, ni la base de datos, ni node_modules.
# =============================================================

$TaskName = "ERPLoga"

schtasks /query /tn $TaskName 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Borrando tarea programada '$TaskName'..."
    schtasks /delete /tn $TaskName /f | Out-Null
    Write-Host "✓ Tarea eliminada"
} else {
    Write-Host "No había tarea instalada"
}

# Matar procesos
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

Write-Host ""
Write-Host "El ERP ya no se arrancará al iniciar sesión."
Write-Host "Para volver a activarlo: .\install.bat"
Write-Host ""
Write-Host "Para borrar la base de datos: dropdb -U postgres loga_erp"
Write-Host "Para borrar PostgreSQL: winget uninstall PostgreSQL.PostgreSQL.16"
