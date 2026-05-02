@echo off
REM Lanza start.ps1 manualmente (sin auto-arranque)
cd /d "%~dp0"
powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0start.ps1"
