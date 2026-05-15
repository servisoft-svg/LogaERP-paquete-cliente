@echo off
REM ============================================================
REM ERP Loga - REPARAR credenciales (ultimo recurso)
REM Garantiza que admin@loga.es tenga password Admin123!
REM Prueba todas las passwords PG conocidas; si nada funciona,
REM hace reset via pg_hba trust temporal.
REM ============================================================

setlocal EnableDelayedExpansion
title ERP Loga - Reparar
color 0E

cd /d "%~dp0"
set "LOGFILE=%~dp0reparar.log"
echo === Reparar %DATE% %TIME% === > "%LOGFILE%"

REM Bcrypt hash de "Admin123!"
set "ADMIN_HASH=$2b$12$DwB7/mM5RsPvTQs9u84Ek.BQWCt1DUK9jAWrTlDPJisEw77rc14KS"
set "PG_BIN=C:\LogaERP\postgresql\bin"
set "PG_DATA=C:\LogaERP\pgdata"

echo.
echo  ============================================================
echo            ERP Loga - REPARAR credenciales
echo  ============================================================
echo.

if not exist "%PG_BIN%\psql.exe" (
  echo [X] PostgreSQL no esta en C:\LogaERP\postgresql\
  echo Ejecuta install.bat primero.
  pause
  exit /b 1
)

REM Asegurar servicio corriendo
sc query postgresql-loga 2>nul | findstr /C:"RUNNING" >nul
if errorlevel 1 (
  echo [*] Arrancando servicio postgresql-loga...
  net start postgresql-loga >> "%LOGFILE%" 2>&1
  timeout /t 4 /nobreak >nul
)

REM Intentar varias passwords para postgres
set "PG_OK=0"
for %%P in (
  "Loga_postgres_2024!"
  "postgres"
  "admin"
  "loga123"
  "Loga2026!"
  "Loga#Admin2026!"
) do (
  if "!PG_OK!"=="0" (
    set "PGPASSWORD=%%~P"
    "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "SELECT 1" >nul 2>&1
    if not errorlevel 1 (
      set "PG_OK=1"
      set "PG_PASS=%%~P"
      echo [OK] Password postgres encontrada
    )
  )
)

if "!PG_OK!"=="0" (
  echo [!] Ninguna password de postgres funciona. Intentando reset via pg_hba trust...
  call :ResetPgHba
  if "!PG_OK!"=="0" (
    echo [X] No se pudo resetear password de postgres. Mira reparar.log
    pause
    exit /b 1
  )
)

REM Resetear password de loga
echo [*] Reseteando password de usuario loga a 'loga123'...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "ALTER USER loga WITH PASSWORD 'loga123';" >> "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo [*] El user loga no existia, creandolo...
  "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "CREATE USER loga WITH PASSWORD 'loga123' CREATEDB SUPERUSER;" >> "%LOGFILE%" 2>&1
)
echo [OK] User loga con password 'loga123'

REM Asegurar que la BD loga_erp existe
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -c "SELECT 1" >nul 2>&1
if errorlevel 1 (
  echo [*] BD loga_erp no existe, creandola...
  "%PG_BIN%\createdb.exe" -h localhost -p 5433 -U postgres -O loga loga_erp >> "%LOGFILE%" 2>&1
  if exist "database\dump-inicial.sql" (
    echo [*] Cargando dump-inicial.sql ^(99 productos, 70 lotes, 10 proveedores, 9 clientes^)...
    "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -q -f "database\dump-inicial.sql" >> "%LOGFILE%" 2>&1
  )
)

REM UPDATE admin con password Admin123! (o INSERT si no existe)
echo [*] Forzando admin@loga.es a password 'Admin123!'...
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -c "UPDATE usuarios SET password_hash='%ADMIN_HASH%' WHERE email='admin@loga.es';" > "%TEMP%\upd.out" 2>&1
type "%TEMP%\upd.out" | findstr /C:"UPDATE 1" >nul
if errorlevel 1 (
  echo [*] Admin no existia, creandolo...
  "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -c "INSERT INTO usuarios (id, nombre, email, password_hash, rol, activo) VALUES (gen_random_uuid(), 'Administrador', 'admin@loga.es', '%ADMIN_HASH%', 'admin', true);" >> "%LOGFILE%" 2>&1
)
echo [OK] admin@loga.es con password 'Admin123!'

REM Verificacion final
echo.
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -c "SELECT email, rol, activo FROM usuarios WHERE email='admin@loga.es';"

echo.
echo  ============================================================
echo                  REPARACION COMPLETA
echo  ============================================================
echo.
echo    Email:      admin@loga.es
echo    Password:   Admin123!
echo.
echo    Si el ERP esta arrancado, refresca el navegador (Ctrl+F5).
echo    Si no, ejecuta logaerp.bat.
echo.
echo  ============================================================
pause
exit /b 0

REM ============================================================
REM Funcion: Reset password postgres via pg_hba trust
REM ============================================================
:ResetPgHba
set "HBA=%PG_DATA%\pg_hba.conf"
if not exist "%HBA%" exit /b 1
echo [*] Backup de pg_hba.conf...
copy /Y "%HBA%" "%HBA%.bak" >nul
REM Sustituir scram-sha-256/md5/password por trust
powershell -NoProfile -Command "(Get-Content '%HBA%') -replace '(?i)(scram-sha-256|md5|password)$','trust' | Set-Content '%HBA%'"
echo [*] Reiniciando servicio para aplicar trust...
net stop postgresql-loga >nul 2>&1
net start postgresql-loga >nul 2>&1
timeout /t 4 /nobreak >nul
set "PGPASSWORD="
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD 'Loga_postgres_2024!';" >> "%LOGFILE%" 2>&1
if errorlevel 1 (
  echo [X] ALTER USER postgres fallo incluso con trust. Restaurando pg_hba...
  copy /Y "%HBA%.bak" "%HBA%" >nul
  net stop postgresql-loga >nul 2>&1
  net start postgresql-loga >nul 2>&1
  set "PG_OK=0"
  exit /b 1
)
echo [*] Restaurando pg_hba.conf normal...
copy /Y "%HBA%.bak" "%HBA%" >nul
del "%HBA%.bak" >nul 2>&1
net stop postgresql-loga >nul 2>&1
net start postgresql-loga >nul 2>&1
timeout /t 4 /nobreak >nul
set "PGPASSWORD=Loga_postgres_2024!"
set "PG_PASS=Loga_postgres_2024!"
set "PG_OK=1"
exit /b 0
