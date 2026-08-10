#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/nav-site}"
ZIP_PATH="${1:-${ZIP_PATH:-/root/nav-site-deploy.zip}}"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: please run as root." >&2
  exit 1
fi

if [ ! -f "${ZIP_PATH}" ]; then
  echo "ERROR: zip not found: ${ZIP_PATH}" >&2
  echo "Upload nav-site-deploy.zip to /root or pass the zip path." >&2
  exit 1
fi

echo "==> install system packages"
apt update
apt install -y curl unzip

if ! command -v mysql >/dev/null 2>&1; then
  echo "==> install MySQL server"
  DEBIAN_FRONTEND=noninteractive apt install -y mysql-server
fi

if ! command -v node >/dev/null 2>&1; then
  echo "==> install Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> install pm2"
  npm i -g pm2
fi

echo "==> prepare app directory"
mkdir -p "${APP_DIR}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR}" ZIP_PATH="${ZIP_PATH}" bash "${SCRIPT_DIR}/update.sh" "${ZIP_PATH}"

echo "==> setup pm2 startup"
pm2 startup || true
pm2 save

echo "==> install complete"
echo "App directory: ${APP_DIR}"
echo "Health check: http://127.0.0.1:3001/api/health"
