@echo off
chcp 65001 > nul
echo ======================================================
echo    LexiRead GitHub Repository Auto-Push Tool
echo ======================================================
echo.
set /p REPO_URL="Enter your GitHub Repository URL (e.g. https://github.com/YOUR_ID/lexiread.git): "

if "%REPO_URL%"=="" (
    echo [Error] Repository URL cannot be empty.
    pause
    exit /b
)

echo.
echo [1/3] Navigating to web_app...
cd /d "%~dp0web_app"

echo [2/3] Linking remote repository...
git remote remove origin 2>nul
git remote add origin %REPO_URL%
git branch -M main

echo [3/3] Pushing to GitHub...
git push -u origin main

echo.
if %ERRORLEVEL% equ 0 (
    echo ======================================================
    echo  [SUCCESS] Code successfully pushed to GitHub!
    echo  Now go to https://render.com and click 'Deploy'!
    echo ======================================================
) else (
    echo [Warning] Push failed or authentication was required. Please check your GitHub credentials.
)
echo.
pause
