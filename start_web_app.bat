@echo off
chcp 65001 > nul
echo =======================================================
echo   [LexiRead] Global English Reading Web Server
echo =======================================================
echo.
echo   Starting server on http://localhost:3000 ...
echo   (Press Ctrl+C to stop the server)
echo.

cd /d "%~dp0web_app"
start "" http://localhost:3000
npm start

pause
