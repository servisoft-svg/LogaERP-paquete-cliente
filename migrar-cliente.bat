@echo off
REM ============================================================
REM ERP Loga - MIGRAR DATOS del cliente a esta version
REM
REM Uso: ejecuta este .bat tras copiar la nueva version sobre la
REM carpeta C:\LogaERP (NO borres la BD del cliente). Hace:
REM  1. Backup de seguridad de la BD actual (por si algo falla)
REM  2. Arranca el backend, que aplica las migraciones nuevas
REM     PRESERVANDO los datos del cliente.
REM ============================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Migrar cliente -> nueva version
color 0E

set "PG_BIN=C:\LogaERP\postgresql\bin"
set "PG_DATA=C:\LogaERP\pgdata"
set "FECHA=%date:~6,4%-%date:~3,2%-%date:~0,2%_%time:~0,2%-%time:~3,2%"
set "FECHA=%FECHA: =0%"
set "BACKUP=%USERPROFILE%\Desktop\BACKUP-PREVIO-MIGRACION-%FECHA%.sql"

echo.
echo  ============================================================
echo      MIGRACION del cliente a la nueva version del ERP
echo  ============================================================
echo.
echo  Este script:
echo   1. Hace un dump de la BD actual (al Escritorio)
echo   2. Aplica las migraciones nuevas automaticamente
echo  Los datos del cliente NO se pierden.
echo.
pause

REM ===== 1. Verificar Postgres corriendo =====
echo.
echo [1/4] Verificando PostgreSQL...
"%PG_BIN%\pg_isready.exe" -h localhost -p 5433 -d loga_erp -U loga >nul 2>&1
if errorlevel 1 (
  echo [X] Postgres no responde en 5433. Arranca primero PostgreSQL.
  pause & exit /b 1
)
echo       OK

REM ===== 2. Backup de seguridad =====
echo.
echo [2/4] Creando backup previo en %BACKUP%...
set PGPASSWORD=loga123
"%PG_BIN%\pg_dump.exe" -h localhost -p 5433 -U loga -d loga_erp -F p -f "%BACKUP%"
if errorlevel 1 (
  echo [X] El backup fallo. ABORTAMOS para no tocar la BD.
  pause & exit /b 1
)
echo       Backup OK: %BACKUP%

REM ===== 3. Instalar deps backend si faltan =====
echo.
echo [3/4] Verificando dependencias del backend...
cd backend
if not exist node_modules (
  echo       Instalando node_modules...
  call npm install --production
)
cd ..
echo       OK

REM ===== 4. Arrancar backend -> aplica migraciones automaticamente =====
echo.
echo [4/4] Arrancando backend (aplicara migraciones pendientes)...
echo.
echo  IMPORTANTE: no cierres esta ventana hasta que veas:
echo    "[migrations] OK - N migraciones aplicadas"
echo  Tras eso, abre el ERP normal con logaerp.bat
echo.
pause

cd backend
call npm run dev

endlocal
