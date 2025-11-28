#!/bin/bash

# 部署打包脚本：为当前项目生成可发布的构建产物
# 功能：
# 1) 安装依赖（如需要）
# 2) 构建前端（Vite）到 dist/
# 3) 归档构建产物到 release/ 下的时间戳目录，并打包为 .tar.gz
# 4) 生成跨平台可执行文件（同时提供后端与前端静态页面）
# 5) 可选参数：--with-deps 在发布目录中安装仅运行时依赖（omit devDependencies）

set -euo pipefail

# 项目根目录
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# 项目名取目录名
APP_NAME="$(basename "$ROOT_DIR")"
RELEASE_BASE_DIR="$ROOT_DIR/release"
RELEASE_DIR="$RELEASE_BASE_DIR/${APP_NAME}"
ARTIFACT_TGZ="$RELEASE_BASE_DIR/${APP_NAME}.tar.gz"

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
info "拷贝构建产物..."
# 前端静态资源
cp -R "$ROOT_DIR/dist" "$RELEASE_DIR/dist"

# 不再拷贝后端源码与 package*、README、vite.config 等开发文件

info "构建跨平台可执行文件"
if ! command -v npx >/dev/null 2>&1; then
  warn "未检测到 npx，跳过可执行文件构建"
else
  BIN_WIN="$RELEASE_DIR/${APP_NAME}-win-x64.exe"
  BIN_MAC="$RELEASE_DIR/${APP_NAME}-macos-x64"
  BIN_LIN="$RELEASE_DIR/${APP_NAME}-linux-x64"
  npx --yes pkg "$ROOT_DIR/server/standalone.cjs" --targets node18-win-x64 --output "$BIN_WIN" || warn "构建 Windows 可执行文件失败"
  npx --yes pkg "$ROOT_DIR/server/standalone.cjs" --targets node18-macos-x64 --output "$BIN_MAC" || warn "构建 macOS 可执行文件失败"
  npx --yes pkg "$ROOT_DIR/server/standalone.cjs" --targets node18-linux-x64 --output "$BIN_LIN" || warn "构建 Linux 可执行文件失败"
  if [[ -f "$BIN_WIN" ]]; then chmod +x "$BIN_WIN"; fi
  if [[ -f "$BIN_MAC" ]]; then chmod +x "$BIN_MAC"; fi
  if [[ -f "$BIN_LIN" ]]; then chmod +x "$BIN_LIN"; fi
fi

# 可选：在发布目录内安装仅运行时依赖，便于拿到目标机即可运行后端
if $WITH_DEPS; then
  warn "可执行包无需安装 node 依赖，已跳过 --with-deps"
fi

info "跳过生成 start.sh（可执行文件已内置前后端服务）"

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
echo "  - 可执行文件            (${APP_NAME}-win-x64.exe, ${APP_NAME}-macos-x64, ${APP_NAME}-linux-x64)"
echo "----------------------------------------"
echo "使用说明："
echo "  1) 将压缩包传至目标服务器并解压："
echo "     tar -xzf ${APP_NAME}.tar.gz"
echo "  2) 直接运行可执行文件（默认端口 3001，可用 PORT 覆盖）："
echo "     macOS:   PORT=3001 ./${APP_NAME}-macos-x64"
echo "     Linux:   PORT=3001 ./${APP_NAME}-linux-x64"
echo "     Windows: set PORT=3001 && ${APP_NAME}-win-x64.exe"
echo "  3) 程序将同时提供后端 API 与前端页面，控制台会打印访问地址与服务信息（无需 start.sh）"
echo "  4) 前端静态资源位于 dist/（已随程序打包），也可自行托管"
echo "----------------------------------------"