@echo off
chcp 65001 > nul

:: ============================================
:: PrismTrack Windows Launcher
:: 端口: 8010
:: ============================================

title PrismTrack

echo.
echo ╔══════════════════════════════════════════════════════════╗
::echo ║                  PrismTrack Launcher                     ║
echo ║              PrismTrack Windows 启动器                    ║
echo ╠══════════════════════════════════════════════════════════╣

:: 切换到脚本所在目录
cd /d "%~dp0"

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ║  错误: 未检测到 Node.js，请先安装 Node.js                ║
    echo ║  下载地址: https://nodejs.org/                           ║
    echo ╚══════════════════════════════════════════════════════════╝
    echo.
    pause
    exit /b 1
)

:: 获取 Node.js 版本
for /f "tokens=*" %%i in ('node -v 2^>nul') do set NODE_VERSION=%%i
echo ║  Node.js: %NODE_VERSION%

:: 设置端口
set PORT=8010
echo ║  端口:    %PORT%
echo ╚══════════════════════════════════════════════════════════╝
echo.

:: 检查依赖是否安装
if not exist "node_modules" (
    echo [INFO] 首次运行，正在安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] 依赖安装失败
        pause
        exit /b 1
    )
    echo.
)

:: 检查 python 目录
if exist "python\python.exe" (
    echo [INFO] 检测到内置 Python 运行时
) else (
    echo [WARN] 未检测到内置 Python，将使用系统 Python
)

:: 检查 ffmpeg
if exist "ffmpeg.exe" (
    echo [INFO] 检测到内置 ffmpeg
) else (
    echo [WARN] 未检测到内置 ffmpeg，将使用系统 PATH 中的 ffmpeg
)

echo.
echo [INFO] 正在启动 PrismTrack 服务...
echo [INFO] 服务地址: http://127.0.0.1:%PORT%
echo [INFO] 按 Ctrl+C 停止服务
echo.

:: 启动启动器
node launcher.cjs

:: 如果启动器退出，暂停以便查看错误
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] 服务异常退出
    pause
)
