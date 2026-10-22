@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo  Silverpane - Windows build
echo ========================================

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found. Install Node.js 20+ from https://nodejs.org and run this file again.
    goto :fail
)

if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 goto :fail
)

if exist dist (
    echo Cleaning old build output...
    rmdir /s /q dist
)

echo Building installer and portable...
call npm run dist
if errorlevel 1 goto :fail

echo.
echo ========================================
echo  BUILD OK. Files are in the "dist" folder:
echo ========================================
dir /b dist\*.exe dist\latest.yml 2>nul
echo.
start "" "%~dp0dist"
pause
exit /b 0

:fail
echo.
echo ========================================
echo  BUILD FAILED
echo ========================================
pause
exit /b 1
