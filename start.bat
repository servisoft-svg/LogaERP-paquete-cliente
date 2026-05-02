@echo off
REM ========================================================
REM ERP Loga - Arranque manual (Windows)
REM ========================================================
REM Lanza start.ps1 en background y abre el navegador.
REM Idempotente: si ya estaba corriendo, solo abre el navegador.
REM ========================================================
cd /d "%~dp0"

REM Lanzar start.ps1 oculto en background. Si el ERP ya corre, sale solo.
start "" /B powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0start.ps1"

REM Esperar unos segundos a que arranque (frontend tarda mas que backend)
echo Arrancando ERP Loga, esto puede tardar 5-10 segundos...
timeout /t 8 /nobreak >nul

REM Abrir navegador
start "" http://localhost:4173

exit /b 0
