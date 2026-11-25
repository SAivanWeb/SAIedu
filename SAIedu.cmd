@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.12+ or 24 LTS and try again.
  pause
  exit /b 1
)
node scripts\launch.mjs --open
if errorlevel 1 pause
