#!/usr/bin/env bash

# ============================================
# PrismTrack Linux Launcher
# 端口: 8010
# ============================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# 切换到脚本所在目录
cd "$(dirname "$0")"

# 打印横幅
print_banner() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║              PrismTrack Linux 启动器                     ║${NC}"
    echo -e "${CYAN}╠══════════════════════════════════════════════════════════╣${NC}"
}

# 打印信息
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

# 打印警告
log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# 打印错误
log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查命令是否存在
command_exists() {
    command -v "$1" &> /dev/null
}

# 检查系统依赖
check_dependencies() {
    local has_error=0

    # 检查 Node.js
    if command_exists node; then
        NODE_VERSION=$(node -v 2>/dev/null || echo "unknown")
        echo -e "${CYAN}║  Node.js:  ${NODE_VERSION}${NC}"
    else
        echo -e "${RED}║  错误: 未检测到 Node.js${NC}"
        echo -e "${RED}║  安装命令: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs${NC}"
        has_error=1
    fi

    # 检查 Python
    PYTHON_CMD=""
    if command_exists python3; then
        PYTHON_CMD="python3"
        echo -e "${CYAN}║  Python:   $(python3 --version 2>&1 | head -1)${NC}"
    elif command_exists python; then
        PYTHON_CMD="python"
        echo -e "${CYAN}║  Python:   $(python --version 2>&1 | head -1)${NC}"
    else
        echo -e "${YELLOW}║  警告: 未检测到系统 Python${NC}"
    fi

    # 检查内置 Python
    if [ -f "python/python" ]; then
        PYTHON_CMD="$(pwd)/python/python"
        echo -e "${CYAN}║  内置Python: 已检测到${NC}"
    fi

    # 检查 ffmpeg
    if [ -f "ffmpeg" ]; then
        echo -e "${CYAN}║  FFmpeg:   内置已检测到${NC}"
    elif command_exists ffmpeg; then
        echo -e "${CYAN}║  FFmpeg:   $(ffmpeg -version 2>&1 | head -1)${NC}"
    else
        echo -e "${YELLOW}║  警告: 未检测到 ffmpeg，安装: sudo apt-get install -y ffmpeg${NC}"
    fi

    # 检查端口
    echo -e "${CYAN}║  端口:     8010${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    if [ $has_error -ne 0 ]; then
        exit 1
    fi
}

# 安装 npm 依赖
install_deps() {
    if [ ! -d "node_modules" ]; then
        log_info "首次运行，正在安装依赖..."
        npm install
        echo ""
    fi
}

# 优雅退出
cleanup() {
    echo ""
    log_info "收到退出信号，正在停止服务..."
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill -TERM "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    log_info "服务已停止"
    exit 0
}

# 注册信号处理
trap cleanup SIGINT SIGTERM SIGHUP

# 主函数
main() {
    print_banner
    check_dependencies
    install_deps

    log_info "正在启动 PrismTrack 服务..."
    log_info "服务地址: http://127.0.0.1:8010"
    log_info "按 Ctrl+C 停止服务"
    echo ""

    # 设置环境变量
    export PORT=8010
    export HOST=127.0.0.1

    # 如果有内置 Python/FFmpeg，设置环境变量
    if [ -f "python/python" ]; then
        export SPLEETER_PYTHON="$(pwd)/python/python"
    fi
    if [ -f "ffmpeg" ]; then
        export FFMPEG="$(pwd)/ffmpeg"
        export FFPROBE="$(pwd)/ffprobe"
    fi

    # 启动服务（后台）
    node launcher.js &
    SERVER_PID=$!

    # 等待服务进程
    wait "$SERVER_PID"
    EXIT_CODE=$?

    if [ $EXIT_CODE -ne 0 ]; then
        echo ""
        log_error "服务异常退出 (退出码: $EXIT_CODE)"
        exit $EXIT_CODE
    fi
}

main "$@"
