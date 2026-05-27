@echo off
REM ============================================================
REM ERP Loga - ARRANQUE PRODUCCION (1 solo puerto 5173)
REM El backend sirve frontend compilado + API en mismo puerto.
REM ============================================================

setlocal EnableDelayedExpansion
title ERP Loga - Produccion
color 0C

cd /d "%~dp0"
set "LOGFILE=%~dp0logaerp.log"
echo === ERP Loga PRODUCCION %DATE% %TIME% === > "%LOGFILE%"

set "PG_BIN=C:\LogaERP\postgresql\bin"

echo.
echo  ##        #######   ######    ###
echo  ##       ##     ## ##    ##  ## ##
echo  ##       ##     ## ##       ##   ##
echo  ##       ##     ## ##   ### ##     ##
echo  ##       ##     ## ##    ## #########
echo  ##       ##     ## ##    ## ##     ##
echo  ########  #######   ######  ##     ##
echo.
echo                  Colas Loga - PRODUCCION
echo  ============================================================
echo.

REM ===== 1. Node =====
echo [1/4] Comprobando Node.js...
where node >nul 2>&1 || ( echo [X] Node.js no instalado. Ejecuta install.bat. & pause & exit /b 1 )
echo       OK

REM ===== 2. PostgreSQL =====
echo [2/4] Comprobando PostgreSQL en puerto 5433...
"%PG_BIN%\pg_isready.exe" -h localhost -p 5433 -d loga_erp -U loga >nul 2>&1
if errorlevel 1 (
  echo       Postgres no responde. Intentando arrancar servicio...
  net start postgresql-loga >nul 2>&1
  timeout /t 5 /nobreak >nul
)
"%PG_BIN%\pg_isready.exe" -h localhost -p 5433 -d loga_erp -U loga >nul 2>&1
if errorlevel 1 (
  echo [X] Postgres no responde. Ejecuta install.bat o arranca el servicio manualmente.
  pause & exit /b 1
)
echo       OK

REM ===== 3. .env existe? =====
echo [3/4] Verificando configuracion...
if not exist "backend\.env" (
  echo [X] Falta backend\.env. Renombra backend\.env.PRODUCCION a backend\.env.
  pause & exit /b 1
)
echo       OK

REM ===== 4. Arrancar backend (puerto 5173, sirve frontend tambien) =====
echo [4/4] Arrancando backend + frontend en puerto 5173...
echo.
echo  ============================================================
echo    Acceso al ERP:  http://localhost:5173
echo  ============================================================
echo.
echo  Esta ventana debe quedarse abierta mientras uses el ERP.
echo  Para cerrar el ERP: cierra esta ventana.
echo.
echo  Log: %LOGFILE%
echo.

REM Lanza navegador en background tras 4 segundos (cuando el backend ya escucha)
start /b cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:5173"

cd backend
call npm start >> "%LOGFILE%" 2>&1

endlocal
