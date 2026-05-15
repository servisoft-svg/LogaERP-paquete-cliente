@echo off
REM ============================================================
REM ERP Loga - CARGAR la BD del repo (database/dump-inicial.sql)
REM Borra la BD actual y carga la del repo tal cual.
REM Resultado: admin@loga.es / Admin123! + 99 productos + 70 lotes
REM ============================================================
setlocal
cd /d "%~dp0"
title Cargar BD Loga
color 0E

set "PG_BIN=C:\LogaERP\postgresql\bin"
set "DUMP=%~dp0database\dump-inicial.sql"

echo.
echo  ============================================================
echo        CARGAR base de datos del repo
echo  ============================================================
echo.
echo  Esto BORRA la BD actual y carga database\dump-inicial.sql.
echo  Resultado: admin@loga.es / Admin123!
echo.
pause

if not exist "%PG_BIN%\psql.exe" ( echo [X] PostgreSQL no en C:\LogaERP\postgresql\. Ejecuta install.bat. & pause & exit /b 1 )
if not exist "%DUMP%" ( echo [X] No existe %DUMP%. Haz 'git pull' primero. & pause & exit /b 1 )

REM Servicio arrancado
sc query postgresql-loga 2>nul | findstr /C:"RUNNING" >nul
if errorlevel 1 ( net start postgresql-loga & timeout /t 4 /nobreak >nul )

REM Detectar password de postgres
set "PG_OK=0"
for %%P in ( "Loga_postgres_2024!" "postgres" "admin" "loga123" ) do (
  if "!PG_OK!"=="0" (
    set "PGPASSWORD=%%~P"
    "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "SELECT 1" >nul 2>&1
    if not errorlevel 1 ( set "PG_OK=1" )
  )
)
if "!PG_OK!"=="0" ( echo [X] No funciona ninguna password. Ejecuta logaerp.bat ^(repara via pg_hba^). & pause & exit /b 1 )

echo.
echo [*] Asegurando user 'loga' con password 'loga123'...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='loga') THEN CREATE USER loga WITH PASSWORD 'loga123' CREATEDB SUPERUSER; ELSE ALTER USER loga WITH PASSWORD 'loga123'; END IF; END $$;"

echo.
echo [*] Cerrando conexiones a loga_erp...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='loga_erp' AND pid<>pg_backend_pid();" >nul 2>&1

echo [*] BORRANDO BD loga_erp anterior...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "DROP DATABASE IF EXISTS loga_erp;"

echo [*] Creando BD loga_erp nueva...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "CREATE DATABASE loga_erp OWNER loga;"

echo [*] Cargando dump-inicial.sql ^(~3 MB, 30 segundos^)...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -q -f "%DUMP%"

echo.
echo  ============================================================
echo                 BD cargada correctamente
echo  ============================================================
echo.
echo    Usuario:  admin@loga.es
echo    Password: Admin123!
echo.
echo    Ahora ejecuta logaerp.bat para arrancar el ERP.
echo  ============================================================
pause
endlocal
