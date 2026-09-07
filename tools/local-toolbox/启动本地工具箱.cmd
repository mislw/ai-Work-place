@echo off
setlocal
cd /d "%~dp0\..\.."
node --import tsx tools\local-toolbox\archive-helper.ts
if errorlevel 1 pause
