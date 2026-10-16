@echo off
rem Windows: double-click this file to start the editor.
cd /d "%~dp0"
where node >nul 2>nul || (echo Please install Node.js first: https://nodejs.org & pause & exit /b 1)
node serve.mjs
pause
