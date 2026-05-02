@echo off
REM ============================================================
REM ERP Loga - Instalacion LIMPIA desde cero
REM ============================================================
REM AVISO: borra la base de datos 'loga_erp' si existe.
REM Datos perdidos no se pueden recuperar.
REM ============================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

where powershell >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PowerShell no encontrado.
    pause
    exit /b 1
)

REM Comprobar admin
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Pidiendo permisos de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath \"%~f0\" -Verb RunAs"
    exit /b 0
)

echo.
echo ============================================================
echo   ERP Loga - INSTALACION LIMPIA (borra DB existente)
echo ============================================================
echo.
echo  Esto BORRARA la base de datos 'loga_erp' actual y la
echo  recreara vacia desde cero. Los datos NO se podran recuperar.
echo.
choice /C SN /M "Continuar"
if errorlevel 2 (
    echo Cancelado.
    pause
    exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Fresh
set EXITCODE=%errorlevel%

echo.
if %EXITCODE% NEQ 0 (
    echo [ERROR] El instalador termino con codigo %EXITCODE%
) else (
    echo [OK] Instalacion limpia completada.
)
echo.
echo Pulsa una tecla para cerrar...
pause >nul
exit /b %EXITCODE%
