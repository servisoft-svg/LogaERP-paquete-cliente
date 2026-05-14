@echo off
REM ============================================================
REM ERP Loga - Actualizar al ultimo codigo de GitHub
REM ============================================================
REM Descarga cambios, recompila, reinicia. La BD del cliente NO
REM se toca: las migraciones nuevas se aplican automaticamente
REM al arrancar el backend, respetando datos existentes.
REM
REM Si algo falla a mitad → datos intactos (rollback transaccional).
REM ============================================================

setlocal
cd /d "%~dp0"

echo.
echo === ERP Loga - Actualizando ===
echo.

REM Verificar git
where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git no esta instalado. Ejecuta:
  echo   winget install Git.Git
  pause
  exit /b 1
)

REM Verificar repo clonado (.git directory)
if not exist ".git" (
  echo [ERROR] Este directorio no es un repo git.
  echo Reinstala el ERP desde install.bat o clona el repo primero.
  pause
  exit /b 1
)

REM 1. Parar ERP
echo [1/5] Parando ERP...
call stop.bat >nul 2>&1
timeout /t 2 /nobreak >nul

REM 2. Descargar codigo nuevo
echo [2/5] Descargando codigo nuevo de GitHub...
git fetch --quiet
git reset --hard origin/main
if errorlevel 1 (
  echo [ERROR] Fallo descargando codigo. Verifica conexion y credenciales.
  pause
  exit /b 1
)

REM 3. Backend deps
echo [3/5] Instalando dependencias backend...
pushd backend
call npm install --silent --no-audit --no-fund
if errorlevel 1 (
  popd
  echo [ERROR] npm install backend fallo.
  pause
  exit /b 1
)
popd

REM 4. Frontend build
echo [4/5] Compilando frontend...
pushd frontend
call npm install --silent --no-audit --no-fund
call npm run build
if errorlevel 1 (
  popd
  echo [ERROR] Build frontend fallo.
  pause
  exit /b 1
)
popd

REM 5. Arrancar (el backend aplicara migraciones nuevas automaticamente)
echo [5/5] Arrancando ERP (aplicando migraciones nuevas si las hay)...
call start.bat

echo.
echo === Actualizacion completada ===
echo.
echo La BD se conserva intacta. Migraciones nuevas aplicadas en frio.
echo Para verificar version actual: git log -1 --oneline
echo.
pause
endlocal
