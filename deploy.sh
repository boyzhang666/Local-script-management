#!/bin/bash

# 部署打包脚本：为当前项目生成可发布的构建产物
# 功能：
# 1) 安装依赖（如需要）
# 2) 构建前端（Vite）到 dist/
# 3) 归档构建产物到 release/ 下的时间戳目录，并打包为 .tar.gz
# 4) 生成一键启动脚本 start.sh（同时启动后端和静态前端）
# 5) 可选参数：--with-deps 在发布目录中安装仅运行时依赖（omit devDependencies）

set -euo pipefail

# 项目根目录
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# 项目名取目录名
APP_NAME="$(basename "$ROOT_DIR")"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RELEASE_BASE_DIR="$ROOT_DIR/release"
RELEASE_DIR="$RELEASE_BASE_DIR/${APP_NAME}-${TIMESTAMP}"
ARTIFACT_TGZ="$RELEASE_BASE_DIR/${APP_NAME}-${TIMESTAMP}.tar.gz"

WITH_DEPS=false
if [[ "${1:-}" == "--with-deps" ]]; then
  WITH_DEPS=true
fi

# 彩色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

# 环境检查
if ! command -v node >/dev/null 2>&1; then
  err "未检测到 Node.js，请先安装 Node.js"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  err "未检测到 npm，请先安装 npm"
  exit 1
fi

info "Node 版本: $(node -v)"
info "npm  版本: $(npm -v)"

# 安装依赖（如果未安装）
if [[ ! -d "node_modules" ]]; then
  info "未检测到 node_modules，开始安装依赖..."
  if [[ -f "package-lock.json" ]]; then
    npm ci
  else
    npm install
  fi
fi

# 构建前端（Vite -> dist/）
info "开始构建前端（vite build）..."
npm run build

if [[ ! -d "dist" ]]; then
  err "构建失败：未生成 dist 目录"
  exit 1
fi
info "前端构建完成：dist/"

# 准备发布目录
info "准备发布目录：$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# 拷贝构建产物与必要文件
info "拷贝构建产物与服务器文件..."
# 前端静态资源
cp -R "$ROOT_DIR/dist" "$RELEASE_DIR/dist"

# 后端服务源码
mkdir -p "$RELEASE_DIR/server"
cp -R "$ROOT_DIR/server/index.js" "$RELEASE_DIR/server/index.js"

# 依赖声明及锁文件（便于目标环境安装运行时依赖）
cp "$ROOT_DIR/package.json" "$RELEASE_DIR/package.json"
if [[ -f "$ROOT_DIR/package-lock.json" ]]; then
  cp "$ROOT_DIR/package-lock.json" "$RELEASE_DIR/package-lock.json"
fi

# 其他辅助文件（可选）
[[ -f "$ROOT_DIR/README.md" ]] && cp "$ROOT_DIR/README.md" "$RELEASE_DIR/README.md"
[[ -f "$ROOT_DIR/vite.config.js" ]] && cp "$ROOT_DIR/vite.config.js" "$RELEASE_DIR/vite.config.js"

# 可选：在发布目录内安装仅运行时依赖，便于拿到目标机即可运行后端
if $WITH_DEPS; then
  info "在发布目录中安装仅运行时依赖（omit devDependencies）..."
  npm ci --omit=dev --prefix "$RELEASE_DIR"
fi

# 生成一键启动脚本（生产用），同时启动后端 + 前端静态服务
info "生成一键启动脚本：$RELEASE_DIR/start.sh"
cat > "$RELEASE_DIR/start.sh" << 'EOF'
#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-5173}"

mkdir -p logs

if ! command -v node >/dev/null 2>&1; then err "未检测到 Node.js"; exit 1; fi

# 提示运行时依赖
if [[ ! -d "node_modules" ]]; then
  warn "未检测到 node_modules，建议先执行: npm ci --omit=dev"
fi

info "启动后端服务 (PORT=$API_PORT)..."
PORT="$API_PORT" node server/index.js > logs/backend.log 2>&1 &
BACK_PID=$!

serve_frontend() {
  if command -v npx >/dev/null 2>&1; then
    info "启动前端静态服务 (端口 $WEB_PORT, 使用 'serve')..."
    ( npx --yes serve -s dist -l "$WEB_PORT" > logs/frontend.log 2>&1 & echo $! ) || return 1
    return 0
  fi
  return 1
}

serve_fallback_python() {
  if command -v python3 >/dev/null 2>&1; then
    info "启动前端静态服务 (端口 $WEB_PORT, 使用 'python3 -m http.server')..."
    ( python3 -m http.server "$WEB_PORT" --directory dist > logs/frontend.log 2>&1 & echo $! ) || return 1
    return 0
  fi
  return 1
}

FRONT_PID=""
if [[ -d "dist" ]]; then
  if FRONT_PID=$(serve_frontend); then
    :
  elif FRONT_PID=$(serve_fallback_python); then
    warn "未找到 npx/serve，使用 python3 作为静态服务"
  else
    warn "未能启动前端静态服务。请自行托管 dist/ (Nginx、Caddy 或 'npx serve -s dist')"
  fi
else
  warn "dist/ 不存在，未能启动前端静态服务。请先执行构建或使用脚本所在目录的 dist/"
fi

trap_ctrl_c() {
  echo
  warn "正在停止服务..."
  if [[ -n "${FRONT_PID}" ]]; then
    kill "${FRONT_PID}" 2>/dev/null || true
  fi
  kill "${BACK_PID}" 2>/dev/null || true
  sleep 0.5
  info "已停止。"
  exit 0
}
trap trap_ctrl_c INT TERM

echo "=================================="
echo "后端： http://127.0.0.1:${API_PORT}/api"
if [[ -n "${FRONT_PID}" ]]; then
  echo "前端： http://127.0.0.1:${WEB_PORT}/"
else
  echo "前端： 未启动（请手动托管 dist/ 或安装 serve）"
fi
echo "日志： logs/frontend.log, logs/backend.log"
echo "💡 按 Ctrl+C 停止所有服务"
echo "=================================="

while true; do
  sleep 5
  # 可选：未来可添加健康检查
done
EOF

chmod +x "$RELEASE_DIR/start.sh"

# 生成压缩包
info "生成压缩包：$ARTIFACT_TGZ"
mkdir -p "$RELEASE_BASE_DIR"
# 使用 -C 切换到 release 目录，避免路径层级过深
( cd "$RELEASE_BASE_DIR" && tar -czf "$(basename "$ARTIFACT_TGZ")" "$(basename "$RELEASE_DIR")" )

info "打包完成！"
echo "----------------------------------------"
echo "构建产物目录：$RELEASE_DIR"
echo "压缩包路径：    $ARTIFACT_TGZ"
echo "包含内容："
echo "  - dist/                 (前端静态资源)"
echo "  - server/index.js       (后端服务入口)"
echo "  - package.json          (依赖声明)"
echo "  - package-lock.json     (锁定文件，如存在)"
echo "  - start.sh              (一键启动脚本)"
echo "  - README.md, vite.config.js (如存在)"
echo "----------------------------------------"
echo "使用说明："
echo "  1) 将压缩包传至目标服务器并解压："
echo "     tar -xzf ${APP_NAME}-${TIMESTAMP}.tar.gz"
echo "  2) 进入解压后的目录，安装运行时依赖（建议）："
echo "     npm ci --omit=dev"
echo "  3) 一键启动（默认后端 3001，前端 5173）："
echo "     ./start.sh"
echo "     或自定义端口： API_PORT=3001 WEB_PORT=5173 ./start.sh"
echo "  4) 前端静态资源位于 dist/，如需生产环境可由 Nginx/静态服务器托管"
echo "----------------------------------------"