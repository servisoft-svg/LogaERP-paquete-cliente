@echo off
REM ============================================================
REM ERP Loga - DIAGNOSTICO completo
REM Genera diagnostico-loga.txt en el Escritorio. Pegamelo en chat.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Diagnostico ERP Loga
color 0E

set "OUT=%USERPROFILE%\Desktop\diagnostico-loga.txt"
set "PG_BIN=C:\LogaERP\postgresql\bin"

(
echo ============================================================
echo  ERP Loga - Diagnostico
echo  Fecha: %DATE% %TIME%
echo  Usuario Windows: %USERNAME%
echo ============================================================
echo.

echo --- 1. Node.js ---
where node 2^>nul
node -v 2^>nul
echo.

echo --- 2. Git ---
where git 2^>nul
git --version 2^>nul
echo.

echo --- 3. Directorio actual ---
cd
echo Archivos en raiz:
dir /b
echo.

echo --- 4. Backend/.env ---
if exist "backend\.env" ( type "backend\.env" ) else ( echo NO EXISTE )
echo.

echo --- 5. Frontend/.env ---
if exist "frontend\.env" ( type "frontend\.env" ) else ( echo NO EXISTE )
echo.

echo --- 6. node_modules ---
if exist "backend\node_modules" ( echo backend SI ) else ( echo backend NO )
if exist "frontend\node_modules" ( echo frontend SI ) else ( echo frontend NO )
echo.

echo --- 7. PostgreSQL ---
if exist "%PG_BIN%\psql.exe" ( "%PG_BIN%\psql.exe" --version ) else ( echo NO existe en %PG_BIN% )
echo.

echo --- 8. Servicio postgresql-loga ---
sc query postgresql-loga 2^>nul
echo.

echo --- 9. Puertos LISTENING ---
echo Puerto 3001:
netstat -ano ^| findstr ":3001 " ^| findstr LISTENING
echo Puerto 5173:
netstat -ano ^| findstr ":5173 " ^| findstr LISTENING
echo Puerto 5433:
netstat -ano ^| findstr ":5433 " ^| findstr LISTENING
echo.

echo --- 10. Conexion PG con todas las passwords conocidas ---
for %%P in ( "Loga_postgres_2024!" "postgres" "admin" "loga123" ) do (
  set "PGPASSWORD=%%~P"
  "%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "SELECT 'OK: ' ^|^| version();" 2^>nul ^| findstr OK
  if not errorlevel 1 echo OK con: %%~P
)
echo.

echo --- 11. BD loga_erp existe? ---
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d postgres -c "SELECT datname FROM pg_database WHERE datname='loga_erp';" 2^>nul
echo.

echo --- 12. Counts en loga_erp ---
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -c "SELECT 'productos' AS tabla, COUNT(*) FROM productos UNION ALL SELECT 'lotes', COUNT(*) FROM lotes WHERE cantidad_actual ^> 0 UNION ALL SELECT 'proveedores', COUNT(*) FROM proveedores UNION ALL SELECT 'clientes', COUNT(*) FROM clientes UNION ALL SELECT 'usuarios', COUNT(*) FROM usuarios;" 2^>nul
echo.

echo --- 13. Usuarios ---
"%PG_BIN%\psql.exe" -h localhost -p 5433 -U postgres -d loga_erp -c "SELECT email, rol, activo FROM usuarios ORDER BY rol DESC;" 2^>nul
echo.

echo --- 14. dump-inicial.sql ---
if exist "database\dump-inicial.sql" (
  for %%I in ("database\dump-inicial.sql") do echo Tamano: %%~zI bytes
) else ( echo NO existe — haz git pull )
echo.

echo ============================================================
) > "%OUT%" 2>&1

echo.
echo Diagnostico en: %OUT%
echo Abriendo en notepad...
start "" notepad "%OUT%"
pause
endlocal
