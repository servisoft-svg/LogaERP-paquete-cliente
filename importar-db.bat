@echo off
REM ============================================================
REM ERP Loga - IMPORTAR BD desde un archivo .sql
REM Te pide la ruta del archivo y lo carga (BORRA la BD actual)
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Importar BD Loga
color 0B

set "PG_BIN=C:\LogaERP\postgresql\bin"

echo.
echo  ============================================================
echo              IMPORTAR base de datos Loga
echo  ============================================================
echo.
echo  CUIDADO: esto BORRA la BD actual y carga la del archivo.
echo.

if not exist "%PG_BIN%\psql.exe" ( echo [X] PostgreSQL no en C:\LogaERP\postgresql\ & pause & exit /b 1 )

REM Pedir ruta del archivo
set /p ARCHIVO="Arrastra el archivo .sql aqui (o escribe la ruta) y pulsa Enter: "

REM Quitar comillas si vienen al arrastrar
set ARCHIVO=%ARCHIVO:"=%

if not exist "%ARCHIVO%" (
  echo [X] No existe el archivo: %ARCHIVO%
  pause
  exit /b 1
)

echo.
echo  Archivo: %ARCHIVO%
echo  Pulsa Enter para continuar ^(Ctrl+C para cancelar^)
pause >nul

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
if "!PG_OK!"=="0" ( echo [X] No funciona ninguna password. & pause & exit /b 1 )

echo [*] Asegurando user loga...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='loga') THEN CREATE USER loga WITH PASSWORD 'loga123' CREATEDB SUPERUSER; ELSE ALTER USER loga WITH PASSWORD 'loga123'; END IF; END $$;" >nul

echo [*] Cerrando conexiones...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='loga_erp' AND pid<>pg_backend_pid();" >nul 2>&1

echo [*] BORRANDO BD loga_erp anterior...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "DROP DATABASE IF EXISTS loga_erp;"

echo [*] Creando BD loga_erp nueva...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "CREATE DATABASE loga_erp OWNER loga;"

echo [*] Cargando archivo .sql ^(puede tardar 30-60 segundos^)...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -q -f "%ARCHIVO%"

echo.
echo  ============================================================
echo                IMPORTACION COMPLETA
echo  ============================================================
echo.
echo    BD cargada desde: %ARCHIVO%
echo.
echo    Arranca el ERP con logaerp.bat
echo  ============================================================
pause
endlocal
