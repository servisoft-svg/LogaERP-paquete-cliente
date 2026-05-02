@echo off
REM ============================================================
REM ERP Loga - Lanzador del instalador Windows
REM ============================================================
REM Doble-clic en este archivo. Eleva permisos y lanza install.ps1
REM ============================================================

setlocal

cd /d "%~dp0"

REM Comprobar PowerShell
where powershell >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell no encontrado.
    echo Necesitas Windows 10 o superior.
    pause
    exit /b 1
)

echo Lanzando instalador en PowerShell...
echo Si Windows pide permisos de administrador, pulsa "Si".
echo.

REM Pedir admin con UAC y ejecutar install.ps1
powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-File','%~dp0install.ps1'"

endlocal
