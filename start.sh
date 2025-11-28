#!/bin/bash

# Local Script Management - 一键启动脚本
# 同时启动前端 Vite 开发服务器和后端 Express 服务器

echo "🚀 启动 Local Script Management..."
echo "=================================="

# 检查是否安装了 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未找到 Node.js，请先安装 Node.js"
    exit 1
fi

# 检查是否安装了 npm
if ! command -v npm &> /dev/null; then
    echo "❌ 错误: 未找到 npm，请先安装 npm"
    exit 1
fi

# 检查 package.json 是否存在
if [ ! -f "package.json" ]; then
    echo "❌ 错误: 未找到 package.json 文件，请确保在项目根目录运行此脚本"
    exit 1
fi

# 检查 node_modules 是否存在，如果不存在则安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装项目依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败"
        exit 1
    fi
fi

# 创建日志目录
mkdir -p logs

# 定义清理函数
cleanup() {
    echo ""
    echo "🛑 正在停止服务..."
    
    # 杀死后台进程
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
        echo "✅ 后端服务已停止"
    fi
    
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
        echo "✅ 前端服务已停止"
    fi
    
    echo "👋 再见！"
    exit 0
}

# 设置信号处理
trap cleanup SIGINT SIGTERM

pick_port() {
  local base=${1:-3001}
  for p in $(seq $base $((base+9))); do
    if ! lsof -n -P -i :"$p" >/dev/null 2>&1; then
      echo "$p"
      return 0
    fi
  done
  echo "$base"
}

API_PORT="${API_PORT:-}"
if [[ -z "$API_PORT" ]]; then
  API_PORT=$(pick_port 3001)
fi
export VITE_API_PORT="$API_PORT"
echo "🔧 启动后端服务器 (端口 $API_PORT)..."
PORT="$API_PORT" node server/index.js > logs/backend.log 2>&1 &
BACKEND_PID=$!

# 等待后端服务启动
sleep 2

# 检查后端是否成功启动
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "❌ 后端服务启动失败，请检查 logs/backend.log"
    exit 1
fi

echo "✅ 后端服务已启动 (PID: $BACKEND_PID)"

echo "🎨 启动前端开发服务器 (端口 5173)..."
npm run dev > logs/frontend.log 2>&1 &
FRONTEND_PID=$!

# 等待前端服务启动
sleep 3

# 检查前端是否成功启动
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "❌ 前端服务启动失败，请检查 logs/frontend.log"
    cleanup
    exit 1
fi

echo "✅ 前端服务已启动 (PID: $FRONTEND_PID)"
echo ""
echo "🎉 所有服务已成功启动！"
echo "=================================="
echo "📱 前端地址: http://localhost:5173"
echo "🔧 后端地址: http://localhost:$API_PORT"
echo "📋 日志文件: logs/frontend.log, logs/backend.log"
echo ""
echo "💡 按 Ctrl+C 停止所有服务"
echo "=================================="

# 保持脚本运行，等待用户中断
while true; do
    # 检查进程是否还在运行
    if ! kill -0 $BACKEND_PID 2>/dev/null; then
        echo "❌ 后端服务意外停止"
        cleanup
        exit 1
    fi
    
    if ! kill -0 $FRONTEND_PID 2>/dev/null; then
        echo "❌ 前端服务意外停止"
        cleanup
        exit 1
    fi
    
    sleep 5
done