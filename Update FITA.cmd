@echo off
setlocal
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
title Update FITA
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0FITA.ps1" -Action update
echo Press any key to close...
pause >nul
