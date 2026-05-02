@echo off
REM ============================================================
REM ERP Loga - Lanzador del instalador Windows
REM ============================================================
REM Doble-clic O clic derecho > Ejecutar como administrador.
REM Si no estamos elevados, pedimos elevacion.
REM ============================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM --- Verificar PowerShell -----------------------------------
where powershell >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell no encontrado. Necesitas Windows 10 o superior.
    pause
    exit /b 1
)

REM --- Comprobar si ya somos administrador --------------------
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo No estas como administrador. Pidiendo elevacion...
    echo Acepta el aviso UAC ^(Si^).
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
)

REM --- Ya somos admin: lanzamos install.ps1 EN ESTA ventana ---
echo.
echo ============================================================
echo   ERP Loga - Instalador Windows
echo   Ejecutando como administrador
echo ============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set EXITCODE=%errorlevel%

echo.
if %EXITCODE% NEQ 0 (
    echo [ERROR] El instalador termino con codigo %EXITCODE%
) else (
    echo [OK] Instalador finalizado correctamente.
)
echo.
echo Pulsa una tecla para cerrar esta ventana...
pause >nul
exit /b %EXITCODE%
