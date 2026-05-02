@echo off
REM ============================================================
REM ERP Loga - Diagnostico Windows
REM ============================================================
REM Recopila informacion del sistema + intenta instalar capturando
REM TODO el output. Genera diagnostico-loga.txt para enviar.
REM ============================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set LOGFILE=%~dp0diagnostico-loga.txt

net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Pidiendo permisos de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath \"%~f0\" -Verb RunAs"
    exit /b 0
)

echo Generando %LOGFILE%
echo Esto tardara varios minutos. NO cierres la ventana.
echo.

(
    echo ===== ERP Loga DIAGNOSTICO =====
    echo Fecha: %date% %time%
    echo Usuario: %USERNAME%
    echo Carpeta: %~dp0
    echo.
    echo ===== Sistema =====
    ver
    systeminfo ^| findstr /B /C:"OS Name" /C:"OS Version" /C:"System Type"
    echo.
    echo ===== PowerShell =====
    powershell -Command "$PSVersionTable | Format-Table"
    echo.
    echo ===== Node.js =====
    where node 2^>^&1
    node -v 2^>^&1
    npm -v 2^>^&1
    echo.
    echo ===== PostgreSQL existente =====
    where psql 2^>^&1
    sc query postgresql-x64-16 2^>^&1
    sc query postgresql-loga 2^>^&1
    dir "C:\Program Files\PostgreSQL\" 2^>^&1
    dir "C:\LogaERP\" 2^>^&1
    echo.
    echo ===== Carpeta proyecto =====
    dir "%~dp0" /b
    echo.
    echo ===== Tarea ERPLoga =====
    schtasks /query /tn ERPLoga /v /fo LIST 2^>^&1
    echo.
    echo ===== Conexion internet =====
    ping -n 2 nodejs.org
    ping -n 2 get.enterprisedb.com
    echo.
    echo ===== EJECUTANDO install.ps1 =====
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Fresh
    echo.
    echo ===== FIN install.ps1 (exit=%errorlevel%) =====
    echo.
    echo ===== Ultimos logs =====
    if exist "%~dp0logs\backend.log" (
        echo --- backend.log [tail 30] ---
        powershell -Command "Get-Content '%~dp0logs\backend.log' -Tail 30"
    )
    if exist "%~dp0logs\frontend.log" (
        echo --- frontend.log [tail 30] ---
        powershell -Command "Get-Content '%~dp0logs\frontend.log' -Tail 30"
    )
    if exist "%~dp0logs\npm-Backend_npm_install.log" (
        echo --- npm backend [tail 30] ---
        powershell -Command "Get-Content '%~dp0logs\npm-Backend_npm_install.log' -Tail 30"
    )
) > "%LOGFILE%" 2>&1

echo.
echo ============================================================
echo Diagnostico generado en:
echo   %LOGFILE%
echo.
echo Abrelo con bloc de notas, copia TODO el contenido y mandamelo.
echo ============================================================
echo.
notepad "%LOGFILE%"
pause
