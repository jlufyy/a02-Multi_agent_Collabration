#!/usr/bin/env bash
# macOS/Linux 版启动脚本（对应 start-tripflow.ps1）。用法：./start-tripflow.sh [端口，默认 8010]
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-8010}"

# 1. Python 环境（需要 3.11+，README 推荐 3.12）
if [ ! -x .venv/bin/python ]; then
  PY=""
  for c in python3.12 python3.13 python3.11 python3; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)'; then PY="$c"; break; fi
  done
  [ -n "$PY" ] || { echo "需要 Python 3.11 或更高版本，可用 'brew install python@3.12' 安装"; exit 1; }
  echo "→ 用 $PY 创建 .venv"
  "$PY" -m venv .venv
  .venv/bin/python -m pip install -q --upgrade pip
  .venv/bin/python -m pip install -c apps/api/requirements-lock.txt -e './apps/api[test]'
fi

# 2. 前端依赖与构建（需要 Node.js 22）
command -v npm >/dev/null 2>&1 || { echo "需要 Node.js 22，可用 'brew install node@22' 安装"; exit 1; }
if [ ! -d tripflow-frontend/tripflow/node_modules ]; then
  npm --prefix tripflow-frontend/tripflow ci --no-audit --no-fund
fi
npm --prefix tripflow-frontend/tripflow run build

# 3. 启动同源服务
[ -f .env ] || echo "提示：没有 .env，地图/大模型服务未配置（复制 .env.example 为 .env 填入密钥后重启）"
echo "TripFlow: http://127.0.0.1:$PORT  （接口文档 /docs，Ctrl+C 结束）"
PORT="$PORT" exec .venv/bin/python apps/api/serve.py
