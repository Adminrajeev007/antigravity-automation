@echo off
setlocal
cd /d "%~dp0"
rem Usage:
rem   run-windows.bat
rem   run-windows.bat -Batch 3
rem   run-windows.bat -ProxyUrl "http://testuser:testpass@172.20.10.6:1080"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-windows.ps1" %*
echo.
echo (orchestrator exited) - press any key to close
pause >nul
