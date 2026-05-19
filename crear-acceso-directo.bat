@echo off
REM ============================================================
REM ERP Loga - Crea acceso directo "Loga ERP" en el ESCRITORIO
REM con icono personalizado (logo.ico) que arranca el ERP.
REM
REM Ejecutalo UNA SOLA VEZ tras instalar el ERP.
REM ============================================================

setlocal
cd /d "%~dp0"
title Crear acceso directo Loga ERP
color 0A

set "ICO=%~dp0logo.ico"
set "BAT=%~dp0logaerp-produccion.bat"
set "LINK=%USERPROFILE%\Desktop\Loga ERP.lnk"

echo.
echo  ============================================================
echo     Creando acceso directo "Loga ERP" en el Escritorio
echo  ============================================================
echo.

if not exist "%ICO%" (
  echo [X] No encuentro logo.ico junto al .bat.
  pause & exit /b 1
)
if not exist "%BAT%" (
  echo [X] No encuentro logaerp-produccion.bat.
  pause & exit /b 1
)

powershell -NoProfile -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%LINK%');" ^
  "$s.TargetPath = '%BAT%';" ^
  "$s.WorkingDirectory = '%~dp0';" ^
  "$s.IconLocation = '%ICO%,0';" ^
  "$s.Description = 'ERP Loga - arranca todo y abre el navegador';" ^
  "$s.Save()"

if errorlevel 1 (
  echo [X] No se pudo crear el acceso directo.
  pause & exit /b 1
)

echo  [OK] Acceso directo creado: "%LINK%"
echo.
echo  Doble-click en ese icono del Escritorio para abrir el ERP.
echo.
pause
endlocal
