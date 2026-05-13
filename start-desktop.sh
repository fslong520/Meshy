#!/usr/bin/env bash
#
# Meshy 桌面客户端（Electron）一键启动脚本
#
# 用法:
#   ./start-desktop.sh          # 正常启动
#   ./start-desktop.sh --dev    # 启动后打开 DevTools
#   ./start-desktop.sh --help   # 显示帮助
#
# 说明:
#   依次启动 后端(9120) → 前端(5173) → Electron 窗口，
#   关闭 Electron 后自动清理后端和前端进程。
#

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# ─── 参数 ───
DEVTOOLS=false
for arg in "$@"; do
  case "$arg" in
    --dev)   DEVTOOLS=true ;;
    --help)
      echo "Meshy 桌面客户端一键启动"
      echo ""
      echo "  ./start-desktop.sh          正常启动"
      echo "  ./start-desktop.sh --dev    启动并打开 DevTools"
      echo "  ./start-desktop.sh --help   显示此帮助"
      exit 0
      ;;
  esac
done

# ─── 颜色 ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ─── 前置检查 ───
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  echo -e "${RED}[错误]${NC} 未检测到图形显示环境（DISPLAY 未设置）。"
  echo "  Electron 需要图形桌面环境才能运行。"
  echo "  若在 SSH 中，请使用 X11 转发或 VNC 等方案。"
  exit 1
fi

# 检查 node_modules
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo -e "${YELLOW}[注意]${NC} 根目录依赖未安装，正在安装..."
  npm install
fi
if [ ! -d "$ROOT_DIR/web/node_modules" ]; then
  echo -e "${YELLOW}[注意]${NC} 前端依赖未安装，正在安装..."
  cd "$ROOT_DIR/web" && npm install && cd "$ROOT_DIR"
fi

# ─── 清理旧进程 ───
echo -e "${CYAN}[1/5]${NC} 清理旧进程..."
kill $(lsof -ti:9120 2>/dev/null) 2>/dev/null || true
kill $(lsof -ti:5173 2>/dev/null) 2>/dev/null || true
sleep 1
echo -e "  ${GREEN}✓${NC} 端口已清理"

# ─── 编译 Electron 主进程 ───
echo -e "${CYAN}[2/5]${NC} 编译 Electron 主进程..."
npx tsc electron/main.ts --outDir electron --esModuleInterop --skipLibCheck 2>&1 || {
  echo -e "  ${YELLOW}⚠ 编译失败，使用已有 main.js${NC}"
}
echo -e "  ${GREEN}✓${NC} 编译完成"

# ─── 启动后端 ───
echo -e "${CYAN}[3/5]${NC} 启动后端服务（端口 9120）..."
nohup npx tsx "$ROOT_DIR/src/index.ts" server --port 9120 \
  > /tmp/meshy-backend.log 2>&1 &
BACKEND_PID=$!

# 等待后端就绪
BACKEND_READY=false
for i in $(seq 1 15); do
  if curl -s http://localhost:9120/ > /dev/null 2>&1; then
    BACKEND_READY=true
    break
  fi
  sleep 1
done

if [ "$BACKEND_READY" = true ]; then
  echo -e "  ${GREEN}✓${NC} 后端就绪（PID: $BACKEND_PID）"
else
  echo -e "  ${RED}✗${NC} 后端启动超时，请查看日志：tail -20 /tmp/meshy-backend.log"
  kill $BACKEND_PID 2>/dev/null || true
  exit 1
fi

# ─── 启动前端 ───
echo -e "${CYAN}[4/5]${NC} 启动前端服务（端口 5173）..."
cd "$ROOT_DIR/web"
nohup npx vite --port 5173 \
  > /tmp/meshy-frontend.log 2>&1 &
FRONTEND_PID=$!
cd "$ROOT_DIR"

# 等待前端就绪
FRONTEND_READY=false
for i in $(seq 1 15); do
  if curl -s http://localhost:5173/ > /dev/null 2>&1; then
    FRONTEND_READY=true
    break
  fi
  sleep 1
done

if [ "$FRONTEND_READY" = true ]; then
  echo -e "  ${GREEN}✓${NC} 前端就绪（PID: $FRONTEND_PID）"
else
  echo -e "  ${RED}✗${NC} 前端启动超时，请查看日志：tail -20 /tmp/meshy-frontend.log"
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  exit 1
fi

# ─── 启动 Electron ───
echo -e "${CYAN}[5/5]${NC} 启动 Electron 桌面客户端..."
echo ""
echo -e "  ${GREEN}========================================${NC}"
echo -e "  ${GREEN}  Meshy 桌面客户端已启动              ${NC}"
echo -e "  ${GREEN}  关闭 Electron 窗口即自动停止所有服务 ${NC}"
echo -e "  ${GREEN}========================================${NC}"
echo ""

ELECTRON_ARGS=""
if [ "$DEVTOOLS" = true ]; then
  # 通过环境变量通知 Electron 打开 DevTools
  export MESHY_DEVTOOLS=1
fi

# 启动 Electron（前台阻塞，直到窗口关闭）
# --disable-gpu 用于无 GPU/VM 环境的兜底，桌面环境不受影响
npx electron "$ROOT_DIR/electron/main.js" --no-sandbox --disable-gpu $ELECTRON_ARGS
ELECTRON_EXIT_CODE=$?

# ─── 清理 ───
echo ""
echo -e "${YELLOW}[清理]${NC} Electron 已退出，正在停止后台服务..."
kill $BACKEND_PID 2>/dev/null || true
kill $FRONTEND_PID 2>/dev/null || true
# 再补一刀，以防残留
kill $(lsof -ti:9120 2>/dev/null) 2>/dev/null || true
kill $(lsof -ti:5173 2>/dev/null) 2>/dev/null || true

echo -e "${GREEN}✓${NC} 已全部停止"
exit $ELECTRON_EXIT_CODE
