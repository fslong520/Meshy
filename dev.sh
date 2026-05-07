#!/usr/bin/env bash
#
# Meshy 全栈开发启动脚本
# 同时启动 后端(dev) + 前端(web)
#
# 使用: ./dev.sh
# 停止: Ctrl+C
#

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    echo ""
    echo "🛑 正在关闭服务..."

    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill "$BACKEND_PID" 2>/dev/null
        echo "  后端已停止 (PID: $BACKEND_PID)"
    fi

    if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        kill "$FRONTEND_PID" 2>/dev/null
        echo "  前端已停止 (PID: $FRONTEND_PID)"
    fi

    echo "👋 再见"
    exit 0
}

trap cleanup SIGINT SIGTERM

echo "========================================"
echo "  Meshy 全栈开发环境"
echo "========================================"
echo ""

# 启动后端 (dev mode)
echo "📦 启动后端开发服务 (server 模式, 端口 9120)..."
cd "$ROOT_DIR"
npm run dev -- server &
BACKEND_PID=$!
echo "  后端 PID: $BACKEND_PID"

# 稍等片刻，让后端先初始化
sleep 2

# 启动前端
echo "🎨 启动前端开发服务..."
cd "$ROOT_DIR/web"
npm run dev &
FRONTEND_PID=$!
echo "  前端 PID: $FRONTEND_PID"

echo ""
echo "========================================"
echo "  ✅ 服务已启动"
echo "  后端: http://localhost:9120"
echo "  前端: http://localhost:5173 (Vite 默认)"
echo "  按 Ctrl+C 停止所有服务"
echo "========================================"
echo ""

# 等待任一进程退出
wait
