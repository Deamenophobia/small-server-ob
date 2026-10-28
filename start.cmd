@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install Node.js and try again.
  pause
  exit /b 1
)
echo Starting Small Server OB. Open http://127.0.0.1:4310 in your browser.
node server.mjs
if errorlevel 1 pause
