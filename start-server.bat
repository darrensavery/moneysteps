@echo off
echo Starting MoneySteps dev server on http://localhost:3000
echo Press Ctrl+C to stop
cd /d "%~dp0"
npx serve . --listen 3000
pause
