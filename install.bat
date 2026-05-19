@echo off
REM ============================================================
REM ERP Loga - INSTALADOR COMPLETO (todo en uno)
REM ------------------------------------------------------------
REM Ejecuta esto UNA VEZ. Despues con logaerp-produccion.bat basta.
REM
REM Que hace:
REM   1. Comprueba Node.js
REM   2. Comprueba PostgreSQL (servicio postgresql-loga en :5433)
REM   3. Crea usuario 'loga' y base de datos 'loga_erp' si faltan
REM   4. Carga el esquema inicial si la BD esta vacia
REM   5. Genera backend\.env si falta
REM   6. Instala dependencias de Node (npm install)
REM ============================================================

setlocal EnableDelayedExpansion
title ERP Loga - Instalador
color 0B

cd /d "%~dp0"
set "ROOT=%~dp0"
set "PG_BIN=C:\LogaERP\postgresql\bin"
set "LOGFILE=%~dp0install.log"
echo === ERP Loga INSTALL %DATE% %TIME% === > "%LOGFILE%"

echo.
echo  ============================================================
echo    ERP Loga - INSTALADOR
echo  ============================================================
echo.

REM ===== 1. Node.js =====
echo [1/6] Comprobando Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js no esta instalado.
  echo     Descarga e instala Node.js v18+ desde: https://nodejs.org
  echo     Despues vuelve a ejecutar este install.bat.
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
echo       OK  ^(!NODE_VER!^)

REM ===== 2. PostgreSQL =====
echo [2/6] Comprobando PostgreSQL...
if not exist "%PG_BIN%\pg_isready.exe" (
  echo [X] No se encuentra PostgreSQL en %PG_BIN%.
  echo     El paquete espera PostgreSQL en C:\LogaERP\postgresql.
  echo     Instalalo manualmente o pide al soporte el paquete completo.
  pause & exit /b 1
)
"%PG_BIN%\pg_isready.exe" -h localhost -p 5433 >nul 2>&1
if errorlevel 1 (
  echo       Servicio parado. Intentando arrancar postgresql-loga...
  net start postgresql-loga >> "%LOGFILE%" 2>&1
  timeout /t 5 /nobreak >nul
  "%PG_BIN%\pg_isready.exe" -h localhost -p 5433 >nul 2>&1
  if errorlevel 1 (
    echo [X] No se pudo arrancar PostgreSQL. Revisa %LOGFILE%.
    pause & exit /b 1
  )
)
echo       OK

REM ===== 3. Usuario y base de datos =====
echo [3/6] Configurando usuario y base de datos...
set "PGPASSWORD=postgres"
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='loga'" 2>nul | findstr /B "1" >nul
if errorlevel 1 (
  echo       Creando usuario 'loga'...
  "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -c "CREATE USER loga WITH PASSWORD 'loga123';" >> "%LOGFILE%" 2>&1
)
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='loga_erp'" 2>nul | findstr /B "1" >nul
set "DB_EXISTED=1"
if errorlevel 1 (
  set "DB_EXISTED=0"
  echo       Creando base de datos 'loga_erp'...
  "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -c "CREATE DATABASE loga_erp OWNER loga;" >> "%LOGFILE%" 2>&1
)
set "PGPASSWORD="
echo       OK

REM ===== 4. Carga del dump inicial (solo si BD recien creada o vacia) =====
echo [4/6] Comprobando esquema...
set "PGPASSWORD=loga123"
for /f %%c in ('"%PG_BIN%\psql.exe" -h localhost -p 5433 -U loga -d loga_erp -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2^>nul') do set "TBL_COUNT=%%c"
if "!TBL_COUNT!"=="" set "TBL_COUNT=0"
if "!TBL_COUNT!"=="0" (
  if exist "database\dump-inicial.sql" (
    echo       Cargando dump-inicial.sql ^(puede tardar^)...
    "%PG_BIN%\psql.exe" -h localhost -p 5433 -U loga -d loga_erp -f "database\dump-inicial.sql" >> "%LOGFILE%" 2>&1
  ) else if exist "database\db-completa.sql" (
    echo       Cargando db-completa.sql ^(puede tardar^)...
    "%PG_BIN%\psql.exe" -h localhost -p 5433 -U loga -d loga_erp -f "database\db-completa.sql" >> "%LOGFILE%" 2>&1
  ) else (
    echo [X] No hay ningun .sql en database\. Revisa el paquete.
    set "PGPASSWORD="
    pause & exit /b 1
  )
) else (
  echo       OK ^(!TBL_COUNT! tablas existentes, no se toca^)
)
set "PGPASSWORD="

REM ===== 5. backend\.env =====
echo [5/6] Verificando backend\.env...
if not exist "backend\.env" (
  echo       Generando backend\.env por defecto...
  > "backend\.env" echo # ERP Loga - configuracion generada por install.bat
  >> "backend\.env" echo DATABASE_URL=postgresql://loga:loga123@localhost:5433/loga_erp
  >> "backend\.env" echo PORT=5173
  >> "backend\.env" echo NODE_ENV=production
  >> "backend\.env" echo LOG_LEVEL=info
  >> "backend\.env" echo CORS_ORIGIN=http://localhost:5173
  >> "backend\.env" echo JWT_SECRET=894118cec95207278b72a038bad06ee16c15a956a9ac15ac5a7e45b25cab87d2
  >> "backend\.env" echo BACKUP_PASSWORD=7dcba21e2b7c12dfeee89540ebb738607cb0bcc8bf78ae32
  >> "backend\.env" echo WEBHOOK_TOKEN=ae1dac880b22ec8cf2f44becd4afb05b
  >> "backend\.env" echo AUTO_HEAL_ADMIN=true
  >> "backend\.env" echo MIGRATIONS_FAIL_SOFT=true
  >> "backend\.env" echo SMTP_HOST=smtp.gmail.com
  >> "backend\.env" echo SMTP_PORT=587
  >> "backend\.env" echo SMTP_USER=
  >> "backend\.env" echo SMTP_PASS=
  >> "backend\.env" echo EMAIL_FROM=
)
echo       OK

REM ===== 6. npm install =====
echo [6/6] Instalando dependencias del backend ^(puede tardar varios minutos^)...
pushd backend
call npm install >> "%LOGFILE%" 2>&1
set "NPM_EXIT=!errorlevel!"
popd
if not "!NPM_EXIT!"=="0" (
  echo [X] npm install fallo ^(codigo !NPM_EXIT!^). Revisa %LOGFILE%.
  pause & exit /b 1
)
echo       OK

echo.
echo  ============================================================
echo    INSTALACION COMPLETADA
echo  ============================================================
echo.
echo  Ahora puedes arrancar el ERP con:
echo      logaerp-produccion.bat
echo.
echo  Acceso:        http://localhost:5173
echo  Usuario:       admin@loga.es
echo  Contrasena:    Admin123!
echo.
pause
endlocal
exit /b 0
