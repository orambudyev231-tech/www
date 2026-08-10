#!/usr/bin/env bash
set -euo pipefail

# 服务器更新脚本：从 GitHub 仓库拉取最新代码 + 装依赖 + pm2 重启（不 build，dist 已入库）
# 用法：bash update.sh
# 可用环境变量覆盖：APP_DIR / APP_NAME / PORT / REPO_URL / BRANCH

APP_DIR="${APP_DIR:-/www/wwwroot/nav-site}"
APP_NAME="${APP_NAME:-nav-site}"
PORT="${PORT:-3001}"
REPO_URL="${REPO_URL:-https://github.com/orambudyev231-tech/www.git}"
BRANCH="${BRANCH:-master}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: command not found: $1" >&2
    exit 1
  fi
}

need_cmd git
need_cmd npm
need_cmd pm2

echo "==> repo: ${REPO_URL} (${BRANCH})"
echo "==> app:  ${APP_DIR}"

if [ ! -d "${APP_DIR}/.git" ]; then
  echo "==> ${APP_DIR} 不是 git 仓库，首次初始化（保留 server/data 与 server/.env）"
  mkdir -p "${APP_DIR}"
  cd "${APP_DIR}"
  git init -b "${BRANCH}"
  git remote add origin "${REPO_URL}"
else
  cd "${APP_DIR}"
  git remote set-url origin "${REPO_URL}"
fi

echo "==> git pull"
git fetch origin "${BRANCH}"
# server/data、server/.env 在 .gitignore 中，reset 不会碰它们
git reset --hard "origin/${BRANCH}"

echo "==> install server dependencies"
npm --prefix server install --omit=dev

echo "==> restart pm2"
PORT="${PORT}" pm2 restart "${APP_NAME}" --update-env || PORT="${PORT}" pm2 start server/src/index.js --name "${APP_NAME}"
pm2 save

echo "==> health check"
if command -v curl >/dev/null 2>&1; then
  for i in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health"; then
      echo
      break
    fi
    if [ "${i}" -eq 20 ]; then
      echo
      echo "WARN: health check failed after waiting. Check logs with: pm2 logs ${APP_NAME} --lines 80" >&2
      break
    fi
    sleep 1
  done
fi

echo "==> done"
