@echo off
REM ============================================================
REM ERP Loga - Setup inicial Windows (maquina sin nada)
REM ============================================================
REM Para PRIMERA instalacion. Instala git -> clona repo ->
REM lanza install.bat que instala Node + Postgres + arranca ERP.
REM Despues, para actualizar: doble-click update.bat
REM ============================================================

setlocal EnableDelayedExpansion

REM ---------------------------------------------------------
REM CONFIGURACION
REM ---------------------------------------------------------
REM IMPORTANTE: el repo es PRIVADO. Antes de entregar este .bat al cliente,
REM reemplaza TU_PAT_AQUI por un Personal Access Token con permiso Contents:Read.
REM Generar en: GitHub -> Settings -> Developer settings -> Personal access tokens
REM             -> Fine-grained -> "Generate new token"
REM             -> Repository access: solo servisoft-svg/erploga
REM             -> Permissions: Repository -> Contents: Read-only
REM ---------------------------------------------------------
set PAT=TU_PAT_AQUI
set REPO_URL=https://x-access-token:%PAT%@github.com/servisoft-svg/erploga.git
set INSTALL_DIR=C:\LogaERP\app

echo.
echo ===========================================================
echo   ERP Loga - Setup inicial Windows
echo ===========================================================
echo   Destino: %INSTALL_DIR%
echo.
echo   Pulsa Enter para continuar, Ctrl+C para cancelar.
pause >nul

REM 1. Verificar admin
net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Necesita administrador. Cierra y haz clic derecho ^> Ejecutar como administrador.
  pause
  exit /b 1
)

REM 2. Verificar PAT configurado
if "%PAT%"=="TU_PAT_AQUI" (
  echo [ERROR] setup.bat sin configurar. Edita la variable PAT con tu token de GitHub.
  pause
  exit /b 1
)

REM 3. Instalar git si falta — winget primero, descarga directa fallback
where git >nul 2>&1
if errorlevel 1 (
  echo [*] Git no detectado, intentando instalar con winget...
  where winget >nul 2>&1
  if not errorlevel 1 (
    winget install --silent --accept-package-agreements --accept-source-agreements Git.Git
  )
  REM Recheck despues de winget
  where git >nul 2>&1
  if errorlevel 1 (
    echo [*] winget no disponible o fallo. Descargando Git MSI directo...
    set "GIT_URL=https://github.com/git-for-windows/git/releases/download/v2.46.0.windows.1/Git-2.46.0-64-bit.exe"
    set "GIT_EXE=%TEMP%\git-installer.exe"
    powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('!GIT_URL!','!GIT_EXE!')"
    if errorlevel 1 (
      echo [ERROR] No se pudo descargar git. Verifica conexion a internet.
      pause
      exit /b 1
    )
    echo [*] Instalando Git (silencioso, ~2 min)...
    "!GIT_EXE!" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"
    del "!GIT_EXE!" >nul 2>&1
    REM Refrescar PATH en esta sesion
    for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "PATH=%%b;%PATH%"
    where git >nul 2>&1 || (
      echo [ERROR] Git instalado pero no en PATH. Reinicia el equipo y vuelve a ejecutar setup.bat.
      pause
      exit /b 1
    )
  )
)
echo [OK] Git disponible

REM 4. Crear carpeta padre
if not exist "C:\LogaERP" mkdir "C:\LogaERP"

REM 5. Clonar repo
if exist "%INSTALL_DIR%\.git" (
  echo [*] %INSTALL_DIR% ya es repo git. Saltando clone (usa update.bat para actualizar).
) else (
  if exist "%INSTALL_DIR%" (
    echo [ERROR] %INSTALL_DIR% existe pero NO es repo git. Borralo o muevelo y reintenta.
    pause
    exit /b 1
  )
  echo [*] Clonando codigo desde GitHub...
  git clone "%REPO_URL%" "%INSTALL_DIR%"
  if errorlevel 1 (
    echo [ERROR] git clone fallo. Posibles causas:
    echo   - Sin internet
    echo   - PAT invalido o expirado
    echo   - Repo movido
    pause
    exit /b 1
  )
  REM Limpiar URL con PAT del config para que git pull futuro use credential manager
  pushd "%INSTALL_DIR%"
  git remote set-url origin https://github.com/servisoft-svg/erploga.git
  REM Guardar credencial en credential manager de Windows (para git pull futuro)
  git config credential.helper manager-core
  popd
)
echo [OK] Codigo descargado en %INSTALL_DIR%

REM 6. Lanzar install.bat
cd /d "%INSTALL_DIR%"
echo.
echo [*] Lanzando instalador principal (Node, PostgreSQL, dependencias, ~10 min)...
echo.
call install.bat

endlocal
