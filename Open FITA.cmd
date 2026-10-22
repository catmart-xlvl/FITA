@echo off
setlocal
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
title FITA
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0FITA.ps1" -Action open
if errorlevel 1 (
  echo Press any key to close...
  pause >nul
)
