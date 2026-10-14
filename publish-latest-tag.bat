@echo off
setlocal EnableExtensions

REM Run from the directory where this .bat file is located.
cd /d "%~dp0"

set "CHANGELOG=CHANGELOG.md"

if not exist "%CHANGELOG%" (
    echo [ERROR] "%CHANGELOG%" was not found.
    pause
    exit /b 1
)

REM Read the first version heading after "# Changelog".
set "VERSION="

for /f "usebackq tokens=1,2" %%A in ("%CHANGELOG%") do (
    if "%%A"=="##" (
        if not defined VERSION set "VERSION=%%B"
    )
)

if not defined VERSION (
    echo [ERROR] No version heading like "## 0.1.0" was found in %CHANGELOG%.
    pause
    exit /b 1
)

set "TAG=v%VERSION%"

echo Latest CHANGELOG version: %VERSION%
echo Git tag to publish: %TAG%
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [ERROR] This folder is not inside a Git repository.
    pause
    exit /b 1
)

REM Do not overwrite an existing local or remote tag.
git show-ref --verify --quiet "refs/tags/%TAG%"
if not errorlevel 1 (
    echo [ERROR] Local tag %TAG% already exists. Tags are not overwritten.
    pause
    exit /b 1
)

git ls-remote origin >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Could not contact remote "origin". Check the remote URL and connection.
    pause
    exit /b 1
)

git ls-remote --exit-code --tags origin "refs/tags/%TAG%" >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] Tag %TAG% already exists on origin. Tags are not overwritten.
    pause
    exit /b 1
)

echo Creating tag %TAG% at the current commit...
git tag "%TAG%"
if errorlevel 1 (
    echo [ERROR] Could not create tag.
    pause
    exit /b 1
)

echo Pushing tag %TAG% to origin...
git push origin "%TAG%"
if errorlevel 1 (
    echo [ERROR] Push failed. The local tag %TAG% was kept.
    echo After resolving the issue, retry with: git push origin %TAG%
    pause
    exit /b 1
)

echo.
echo [SUCCESS] Tag %TAG% was pushed to origin.
exit /b 0
