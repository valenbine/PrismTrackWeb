@echo off
chcp 936 > nul

:: ============================================
:: PrismTrack Windows Launcher
:: Port: 8010
:: ============================================

title PrismTrack

echo.
echo PrismTrack Windows Launcher
echo ========================
echo.

:: Switch to script directory
cd /d "%~dp0"

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found. Please install Node.js first.
    echo Download: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Print Node.js version
for /f "tokens=*" %%i in ('node -v 2^>nul') do set NODE_VERSION=%%i
echo Node.js: %NODE_VERSION%

:: Set port
set PORT=8010
echo Port:    %PORT%
echo.

:: Check pre-bundled dependencies
if exist "node_modules" (
    echo [INFO] Pre-bundled dependencies detected
) else (
    echo [WARN] node_modules directory was not found
)

:: Check bundled Python runtime
if exist "python\python.exe" (
    echo [INFO] Bundled Python runtime detected
) else (
    echo [WARN] Bundled Python runtime was not found. System Python will be used.
)

:: Check bundled ffmpeg
if exist "ffmpeg.exe" (
    echo [INFO] Bundled ffmpeg detected
) else (
    echo [WARN] Bundled ffmpeg was not found. ffmpeg from PATH will be used.
)

echo.
echo [INFO] Starting PrismTrack service...
echo [INFO] Service URL: http://127.0.0.1:%PORT%
echo [INFO] Press Ctrl+C to stop the service
echo.

:: Start launcher
node launcher.cjs

:: Pause on startup failure
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Service exited unexpectedly
    pause
)
