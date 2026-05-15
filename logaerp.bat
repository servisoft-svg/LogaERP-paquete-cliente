@echo off
REM ============================================================
REM ERP Loga - Arranque rapido (Windows)
REM ============================================================
REM Comprueba dependencias, crea BD si falta, arranca backend +
REM frontend y abre el navegador.
REM
REM Login por defecto:  admin@loga.es / Admin123!
REM ============================================================

setlocal EnableDelayedExpansion
chcp 65001 > nul
title ERP Loga
color 0C

cls
echo.
echo   ██╗      ██████╗  ██████╗  █████╗      ███████╗██████╗ ██████╗
echo   ██║     ██╔═══██╗██╔════╝ ██╔══██╗     ██╔════╝██╔══██╗██╔══██╗
echo   ██║     ██║   ██║██║  ███╗███████║     █████╗  ██████╔╝██████╔╝
echo   ██║     ██║   ██║██║   ██║██╔══██║     ██╔══╝  ██╔══██╗██╔═══╝
echo   ███████╗╚██████╔╝╚██████╔╝██║  ██║     ███████╗██║  ██║██║
echo   ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝
echo.
color 07
echo                Sistema de gestion - Colas Loga
echo   ============================================================
echo.

cd /d "%~dp0"

REM ---- 1. Comprobar Node ----
where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js no instalado. Ejecuta install.bat primero.
  pause
  exit /b 1
)
echo [OK] Node.js detectado

REM ---- 2. Comprobar PostgreSQL ----
set "PG_BIN=C:\LogaERP\postgresql\bin"
if not exist "%PG_BIN%\psql.exe" (
  echo [X] PostgreSQL no instalado en C:\LogaERP\postgresql.
  echo     Ejecuta install.bat primero.
  pause
  exit /b 1
)
echo [OK] PostgreSQL detectado

REM ---- 3. Arrancar servicio PostgreSQL si no corre ----
sc query postgresql-loga | findstr /C:"RUNNING" >nul
if errorlevel 1 (
  echo [*] Iniciando servicio PostgreSQL...
  net start postgresql-loga >nul 2>&1
  timeout /t 3 /nobreak >nul
)
echo [OK] PostgreSQL en marcha

REM ---- 4. Comprobar/crear backend/.env ----
if not exist "backend\.env" (
  echo [*] Creando backend\.env...
  (
    echo DATABASE_URL=postgresql://loga:loga123@localhost:5433/loga_erp
    echo PORT=3001
    echo NODE_ENV=development
    echo JWT_SECRET=loga-dev-secret-change-in-production-aaaaaaaaaaaaaaaaaaaaa
    echo BACKUP_PASSWORD=loga-backup-dev-password-change-this-in-production-too
    echo CORS_ORIGIN=http://localhost:4173
    echo LOG_LEVEL=info
  ) > "backend\.env"
)
echo [OK] backend\.env

REM ---- 5. Comprobar/crear frontend/.env ----
if not exist "frontend\.env" (
  echo VITE_API_URL=http://localhost:3001 > "frontend\.env"
)
echo [OK] frontend\.env

REM ---- 6. Comprobar BD existe; si no, crearla + cargar dump ----
set PGPASSWORD=loga123
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U loga -d loga_erp -c "SELECT 1" >nul 2>&1
if errorlevel 1 (
  echo [*] Base de datos no encontrada. Creando + cargando datos iniciales...
  set PGPASSWORD=Loga_postgres_2024!
  "%PG_BIN%\createdb.exe" -h localhost -p 5433 -U postgres -O loga loga_erp 2>nul
  if exist "database\dump-inicial.sql" (
    "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -v ON_ERROR_STOP=1 -q -f "database\dump-inicial.sql" >nul 2>&1
    echo [OK] Base de datos creada con datos iniciales
  ) else (
    echo [!] dump-inicial.sql no encontrado. BD vacia.
  )
  set PGPASSWORD=loga123
)
echo [OK] Base de datos disponible

REM ---- 7. Comprobar dependencias instaladas ----
if not exist "backend\node_modules" (
  echo [*] Instalando dependencias backend (1-2 min)...
  pushd backend && call npm install --silent --no-audit --no-fund && popd
)
if not exist "frontend\node_modules" (
  echo [*] Instalando dependencias frontend (1-2 min)...
  pushd frontend && call npm install --silent --no-audit --no-fund && popd
)
echo [OK] Dependencias listas

REM ---- 8. Matar procesos previos en los puertos ----
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4173 " ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

REM ---- 9. Arrancar backend en ventana aparte ----
echo [*] Arrancando backend...
start "ERP Loga - Backend" cmd /c "cd /d %~dp0backend && npm run dev"

REM ---- 10. Arrancar frontend en ventana aparte ----
echo [*] Arrancando frontend...
start "ERP Loga - Frontend" cmd /c "cd /d %~dp0frontend && npm run dev"

REM ---- 11. Esperar a que esten listos y abrir navegador ----
echo.
echo   ============================================================
echo            Iniciando servicios. Espere 10 segundos...
echo   ============================================================
timeout /t 10 /nobreak >nul

REM Detectar puerto del frontend (5173 por defecto en npm run dev)
start "" http://localhost:5173

echo.
echo   ============================================================
echo                    ERP Loga arrancado
echo   ============================================================
echo.
echo     URL:        http://localhost:5173
echo     Email:      admin@loga.es
echo     Password:   Admin123!
echo.
echo     Cierra esta ventana cuando termines (los servicios
echo     seguiran en las otras 2 ventanas abiertas).
echo     Para parar todo: cierra las 2 ventanas de Backend
echo     y Frontend, o ejecuta stop.bat.
echo.
echo   ============================================================

pause
endlocal
