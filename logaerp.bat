@echo off
REM ============================================================
REM ERP Loga - Arranque rapido Windows
REM Log: logaerp.log (mira ese archivo si algo falla)
REM ============================================================

setlocal EnableDelayedExpansion
title ERP Loga
color 0C

cd /d "%~dp0"
set "LOGFILE=%~dp0logaerp.log"
echo === ERP Loga arranque %DATE% %TIME% === > "%LOGFILE%"

echo.
echo  ##        #######   ######    ###       ######## ########  ########
echo  ##       ##     ## ##    ##  ## ##      ##       ##     ## ##     ##
echo  ##       ##     ## ##       ##   ##     ##       ##     ## ##     ##
echo  ##       ##     ## ##   ### ##     ##   ######   ########  ########
echo  ##       ##     ## ##    ## #########   ##       ##   ##   ##
echo  ##       ##     ## ##    ## ##     ##   ##       ##    ##  ##
echo  ########  #######   ######  ##     ##   ######## ##     ## ##
echo.
echo                   Sistema de gestion - Colas Loga
echo  ============================================================
color 07
echo.

REM ===== 1. Node =====
echo [1/8] Comprobando Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado.
  echo Instalalo desde https://nodejs.org o ejecuta install.bat primero.
  echo. >> "%LOGFILE%"
  echo Falta Node.js >> "%LOGFILE%"
  pause
  exit /b 1
)
for /f %%v in ('node -v') do echo       Node %%v
echo Node OK >> "%LOGFILE%"

REM ===== 2. PostgreSQL =====
echo [2/8] Comprobando PostgreSQL...
set "PG_BIN=C:\LogaERP\postgresql\bin"
if not exist "%PG_BIN%\psql.exe" (
  echo [ERROR] PostgreSQL no instalado en C:\LogaERP\postgresql\
  echo Ejecuta install.bat ^(boton derecho - Ejecutar como administrador^).
  echo Falta PostgreSQL en C:\LogaERP\postgresql >> "%LOGFILE%"
  pause
  exit /b 1
)
echo       PostgreSQL en C:\LogaERP\postgresql
echo PostgreSQL OK >> "%LOGFILE%"

REM ===== 3. Servicio PG arrancado =====
echo [3/8] Comprobando servicio PostgreSQL...
sc query postgresql-loga 2>nul | findstr /C:"RUNNING" >nul
if errorlevel 1 (
  echo       Servicio parado, arrancandolo...
  net start postgresql-loga >> "%LOGFILE%" 2>&1
  timeout /t 4 /nobreak >nul
  sc query postgresql-loga 2>nul | findstr /C:"RUNNING" >nul
  if errorlevel 1 (
    echo [ERROR] No se pudo arrancar el servicio postgresql-loga.
    echo Mira el log: %LOGFILE%
    pause
    exit /b 1
  )
)
echo       Servicio postgresql-loga corriendo
echo Servicio PG OK >> "%LOGFILE%"

REM ===== 4. backend/.env =====
echo [4/8] backend\.env...
if not exist "backend\.env" (
  echo       Creando backend\.env...
  (
    echo DATABASE_URL=postgresql://loga:loga123@localhost:5433/loga_erp
    echo PORT=3001
    echo NODE_ENV=development
    echo JWT_SECRET=loga-dev-secret-32-chars-min-aaaaaaaaaaaaaaaaaaaaaaaa
    echo BACKUP_PASSWORD=loga-backup-dev-password-aaaaaaaaaaaaaaaaaaaaaaaa
    echo CORS_ORIGIN=http://localhost:5173
    echo LOG_LEVEL=info
  ) > "backend\.env"
)
echo       backend\.env OK

REM ===== 5. frontend/.env =====
if not exist "frontend\.env" (
  echo VITE_API_URL=http://localhost:3001 > "frontend\.env"
)

REM ===== 6. BD existe? =====
echo [5/8] Comprobando base de datos loga_erp...
set "PGPASSWORD=loga123"
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U loga -d loga_erp -c "SELECT 1" >> "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo       BD no accesible o no existe. Reseteando password de loga y creando BD...
  set "PGPASSWORD=Loga_postgres_2024!"
  "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "ALTER USER loga WITH PASSWORD 'loga123';" >> "%LOGFILE%" 2>&1
  "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='loga_erp'" 2>nul | findstr "1" >nul
  if errorlevel 1 (
    echo       Creando BD loga_erp...
    "%PG_BIN%\createdb.exe" -h localhost -p 5433 -U postgres -O loga loga_erp >> "%LOGFILE%" 2>&1
  )
  if exist "database\dump-inicial.sql" (
    echo       Cargando dump-inicial.sql ^(datos iniciales^)...
    "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -q -f "database\dump-inicial.sql" >> "%LOGFILE%" 2>&1
  )
  set "PGPASSWORD=loga123"
)
echo       BD lista
echo BD OK >> "%LOGFILE%"

REM ===== 7. Dependencias =====
echo [6/8] Dependencias npm...
if not exist "backend\node_modules" (
  echo       Instalando backend ^(1-3 min^)...
  pushd backend
  call npm install --silent --no-audit --no-fund >> "%LOGFILE%" 2>&1
  if errorlevel 1 (
    popd
    echo [ERROR] npm install backend fallo. Mira el log: %LOGFILE%
    pause
    exit /b 1
  )
  popd
)
if not exist "frontend\node_modules" (
  echo       Instalando frontend ^(1-3 min^)...
  pushd frontend
  call npm install --silent --no-audit --no-fund >> "%LOGFILE%" 2>&1
  if errorlevel 1 (
    popd
    echo [ERROR] npm install frontend fallo. Mira el log: %LOGFILE%
    pause
    exit /b 1
  )
  popd
)
echo       Dependencias OK

REM ===== 8. Matar puertos previos =====
echo [7/8] Liberando puertos 3001 y 5173...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " ^| findstr LISTENING 2^>nul') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr LISTENING 2^>nul') do taskkill /F /PID %%a >nul 2>&1

REM ===== 9. Arrancar =====
echo [8/8] Arrancando backend y frontend...
start "ERP Loga - Backend"  cmd /k "cd /d %~dp0backend && npm run dev"
start "ERP Loga - Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ============================================================
echo  Esperando 12 segundos a que arranquen los servicios...
echo ============================================================
timeout /t 12 /nobreak >nul

REM Abrir navegador (vite usa 5173 por defecto en dev)
start "" http://localhost:5173

echo.
echo ============================================================
echo                   ERP Loga arrancado
echo ============================================================
echo.
echo   URL:        http://localhost:5173
echo   Email:      admin@loga.es
echo   Password:   Admin123!
echo.
echo   Para parar: cierra las 2 ventanas "Backend" y "Frontend"
echo.
echo   Log de este arranque: %LOGFILE%
echo ============================================================
echo.
pause
endlocal
