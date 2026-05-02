@echo off
REM ========================================================
REM ERP Loga - Desinstalacion COMPLETA
REM ========================================================
REM Borra TODO: servicio postgresql-loga, C:\LogaERP\,
REM node_modules, builds, .env, tarea programada, procesos.
REM Usalo cuando quieras reinstalar desde cero.
REM ========================================================

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo [ERROR] Necesitas permisos de Administrador.
    echo Cierra esta ventana y vuelve a abrir uninstall-all.bat
    echo con clic derecho ^> Ejecutar como administrador.
    echo.
    pause
    exit /b 1
)

echo.
echo  ATENCION: esto borra la base de datos, PostgreSQL DEDICADO,
echo            node_modules, builds y configuracion.
echo            (El codigo del proyecto NO se toca)
echo.
choice /M "Continuar con la desinstalacion completa"
if errorlevel 2 exit /b 0

cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" -All

echo.
pause
