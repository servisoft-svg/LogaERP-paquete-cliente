@echo off
REM ============================================================
REM ERP Loga - Arranque + AUTO-REPARAR (todo-en-uno)
REM Garantiza siempre: admin@loga.es / Admin123!
REM ============================================================

setlocal EnableDelayedExpansion
title ERP Loga
color 0C

cd /d "%~dp0"
set "LOGFILE=%~dp0logaerp.log"
echo === ERP Loga %DATE% %TIME% === > "%LOGFILE%"

set "ADMIN_HASH=$2b$12$DwB7/mM5RsPvTQs9u84Ek.BQWCt1DUK9jAWrTlDPJisEw77rc14KS"
set "PG_BIN=C:\LogaERP\postgresql\bin"
set "PG_DATA=C:\LogaERP\pgdata"

echo.
echo  ##        #######   ######    ###       ######## ########  ########
echo  ##       ##     ## ##    ##  ## ##      ##       ##     ## ##     ##
echo  ##       ##     ## ##       ##   ##     ##       ##     ## ##     ##
echo  ##       ##     ## ##   ### ##     ##   ######   ########  ########
echo  ##       ##     ## ##    ## #########   ##       ##   ##   ##
echo  ##       ##     ## ##    ## ##     ##   ##       ##    ##  ##
echo  ########  #######   ######  ##     ##   ######## ##     ## ##
echo.
color 07
echo                   Sistema de gestion - Colas Loga
echo  ============================================================
echo.

REM ===== 1. Node =====
echo [1/10] Comprobando Node.js...
where node >nul 2>&1 || ( echo [X] Node.js no instalado. Ejecuta install.bat. & pause & exit /b 1 )
echo       OK

REM ===== 2. PostgreSQL =====
echo [2/10] Comprobando PostgreSQL...
if not exist "%PG_BIN%\psql.exe" ( echo [X] PostgreSQL no instalado. Ejecuta install.bat. & pause & exit /b 1 )
echo       OK

REM ===== 3. Servicio =====
echo [3/10] Servicio PostgreSQL...
sc query postgresql-loga 2>nul | findstr /C:"RUNNING" >nul
if errorlevel 1 ( net start postgresql-loga >> "%LOGFILE%" 2>&1 & timeout /t 4 /nobreak >nul )
echo       OK

REM ===== 4. Detectar password de postgres (prueba varias) =====
echo [4/10] Detectando password super-usuario PostgreSQL...
set "PG_OK=0"
for %%P in ( "Loga_postgres_2024!" "postgres" "admin" "loga123" ) do (
  if "!PG_OK!"=="0" (
    set "PGPASSWORD=%%~P"
    "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "SELECT 1" >nul 2>&1
    if not errorlevel 1 (
      set "PG_OK=1"
      set "PG_PASS=%%~P"
    )
  )
)
if "!PG_OK!"=="0" (
  echo       Ninguna password conocida. Reseteando via pg_hba trust...
  call :ResetPgHba
)
if "!PG_OK!"=="0" ( echo [X] No se pudo recuperar password postgres. & pause & exit /b 1 )
echo       OK

REM ===== 5. User loga con password 'loga123' (idempotente) =====
echo [5/10] User 'loga' con password 'loga123'...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='loga') THEN CREATE USER loga WITH PASSWORD 'loga123' CREATEDB SUPERUSER; ELSE ALTER USER loga WITH PASSWORD 'loga123'; END IF; END $$;" >> "%LOGFILE%" 2>&1
echo       OK

REM ===== 6. BD loga_erp + carga dump si no existe =====
echo [6/10] Base de datos loga_erp...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -c "SELECT 1 FROM usuarios LIMIT 1" >nul 2>&1
if errorlevel 1 (
  echo       No existe o vacia. Creando + cargando dump-inicial.sql...
  "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "CREATE DATABASE loga_erp OWNER loga;" >> "%LOGFILE%" 2>&1
  if exist "database\dump-inicial.sql" (
    "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -q -f "database\dump-inicial.sql" >> "%LOGFILE%" 2>&1
  ) else if exist "backend\database\migrations" (
    echo       dump no encontrado, aplicando migraciones...
    for %%f in ("backend\database\migrations\*.sql") do (
      "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -q -f "%%f" >> "%LOGFILE%" 2>&1
    )
  )
)
echo       OK

REM ===== 7. FORZAR password admin a Admin123! (siempre) =====
echo [7/10] Garantizando admin@loga.es con password 'Admin123!'...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -c "UPDATE usuarios SET password_hash='%ADMIN_HASH%', activo=true WHERE email='admin@loga.es';" > "%TEMP%\upd.out" 2>&1
type "%TEMP%\upd.out" | findstr /C:"UPDATE 1" >nul
if errorlevel 1 (
  echo       Admin no existe, creandolo...
  "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -c "INSERT INTO usuarios (id, nombre, email, password_hash, rol, activo) VALUES (gen_random_uuid(), 'Administrador', 'admin@loga.es', '%ADMIN_HASH%', 'admin', true) ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, activo=true;" >> "%LOGFILE%" 2>&1
)
echo       OK

REM ===== 8. backend\.env y frontend\.env =====
echo [8/10] Archivos .env...
if not exist "backend\.env" (
  > "backend\.env" (
    echo DATABASE_URL=postgresql://loga:loga123@localhost:5433/loga_erp
    echo PORT=3001
    echo NODE_ENV=development
    echo JWT_SECRET=loga-dev-secret-32-chars-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    echo BACKUP_PASSWORD=loga-backup-dev-pass-aaaaaaaaaaaaaaaaaaaaaaaaaaa
    echo CORS_ORIGIN=http://localhost:5173
    echo LOG_LEVEL=info
  )
)
if not exist "frontend\.env" ( echo VITE_API_URL=http://localhost:3001 > "frontend\.env" )
echo       OK

REM ===== 9. Dependencias =====
echo [9/10] Dependencias npm...
if not exist "backend\node_modules" (
  echo       Instalando backend ^(1-3 min^)...
  pushd backend & call npm install --silent --no-audit --no-fund >> "%LOGFILE%" 2>&1 & popd
)
if not exist "frontend\node_modules" (
  echo       Instalando frontend ^(1-3 min^)...
  pushd frontend & call npm install --silent --no-audit --no-fund >> "%LOGFILE%" 2>&1 & popd
)
echo       OK

REM ===== 10. Arrancar =====
echo [10/10] Arrancando backend y frontend...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001 " ^| findstr LISTENING 2^>nul') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr LISTENING 2^>nul') do taskkill /F /PID %%a >nul 2>&1
start "ERP Loga - Backend"  cmd /k "cd /d %~dp0backend && npm run dev"
start "ERP Loga - Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo  ============================================================
echo                 Iniciando... espera 12 segundos
echo  ============================================================
timeout /t 12 /nobreak >nul
start "" http://localhost:5173

echo.
echo  ============================================================
echo                   ERP Loga arrancado
echo  ============================================================
echo.
echo    URL:        http://localhost:5173
echo    Email:      admin@loga.es
echo    Password:   Admin123!
echo.
echo    Para parar: cierra las 2 ventanas "Backend" y "Frontend"
echo    Log:        %LOGFILE%
echo.
echo  ============================================================
pause
exit /b 0

REM ============================================================
REM Funcion: reset password postgres via pg_hba trust temporal
REM ============================================================
:ResetPgHba
set "HBA=%PG_DATA%\pg_hba.conf"
if not exist "%HBA%" exit /b 1
copy /Y "%HBA%" "%HBA%.bak" >nul 2>&1
powershell -NoProfile -Command "(Get-Content '%HBA%') -replace '(?i)(scram-sha-256|md5|password)$','trust' | Set-Content '%HBA%'" >> "%LOGFILE%" 2>&1
net stop postgresql-loga >nul 2>&1
net start postgresql-loga >nul 2>&1
timeout /t 4 /nobreak >nul
set "PGPASSWORD="
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD 'Loga_postgres_2024!';" >> "%LOGFILE%" 2>&1
copy /Y "%HBA%.bak" "%HBA%" >nul 2>&1
del "%HBA%.bak" >nul 2>&1
net stop postgresql-loga >nul 2>&1
net start postgresql-loga >nul 2>&1
timeout /t 4 /nobreak >nul
set "PGPASSWORD=Loga_postgres_2024!"
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "SELECT 1" >nul 2>&1
if not errorlevel 1 ( set "PG_OK=1" & set "PG_PASS=Loga_postgres_2024!" )
exit /b 0
