@echo off
title PDF Editor - Dev Server
cd /d "%~dp0"
echo Starting PDF Editor...
start "" "http://localhost:3000"
npx vite --port 3000
pause
