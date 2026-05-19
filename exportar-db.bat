@echo off
REM ============================================================
REM ERP Loga - EXPORTAR toda la BD a un archivo .sql
REM Genera: backup-YYYY-MM-DD.sql en el escritorio
REM ============================================================
setlocal
cd /d "%~dp0"
title Exportar BD Loga
color 0A

set "PG_BIN=C:\LogaERP\postgresql\bin"
set "FECHA=%date:~6,4%-%date:~3,2%-%date:~0,2%"
set "DEST=%USERPROFILE%\Desktop\loga-bd-%FECHA%.sql"

echo.
echo  ============================================================
echo               EXPORTAR base de datos Loga
echo  ============================================================
echo.

if not exist "%PG_BIN%\pg_dump.exe" ( echo [X] PostgreSQL no en C:\LogaERP\postgresql\ & pause & exit /b 1 )

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

echo [*] Exportando BD a: %DEST%
echo     Esto puede tardar 30-60 segundos...
"%PG_BIN%\pg_dump.exe" -h localhost -p 5433 -U postgres -d loga_erp > "%DEST%"
if errorlevel 1 ( echo [X] Error al exportar. & pause & exit /b 1 )

for %%I in ("%DEST%") do set SIZE=%%~zI
set /a SIZEKB=%SIZE% / 1024

echo.
echo  ============================================================
echo                EXPORTACION COMPLETA
echo  ============================================================
echo.
echo    Archivo:  %DEST%
echo    Tamano:   %SIZEKB% KB
echo.
echo    Para llevartelo a otro PC:
echo      1. Copia ese archivo .sql a un USB o nube
echo      2. En el otro PC, ponlo en cualquier carpeta
echo      3. Ejecuta importar-db.bat
echo  ============================================================
pause
endlocal
