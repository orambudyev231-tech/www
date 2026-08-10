#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/nav-site}"
APP_NAME="${APP_NAME:-nav-site}"
PORT="${PORT:-3001}"
ZIP_PATH="${1:-${ZIP_PATH:-}}"

find_zip() {
  if [ -n "${ZIP_PATH}" ] && [ -f "${ZIP_PATH}" ]; then
    echo "${ZIP_PATH}"
    return
  fi

  for path in \
    "/root/nav-site-deploy.zip" \
    "${APP_DIR}/nav-site-deploy.zip" \
    "$(pwd)/nav-site-deploy.zip"; do
    if [ -f "${path}" ]; then
      echo "${path}"
      return
    fi
  done

  echo "ERROR: nav-site-deploy.zip not found. Upload it to /root or pass the zip path." >&2
  exit 1
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: command not found: $1" >&2
    exit 1
  fi
}

ZIP_PATH="$(find_zip)"
WORK_DIR="$(mktemp -d /tmp/nav-site-update.XXXXXX)"
DATA_BACKUP="$(mktemp -d /tmp/nav-site-data.XXXXXX)"
ENV_BACKUP="/tmp/nav-site-env.$$"

cleanup() {
  rm -rf "${WORK_DIR}" "${DATA_BACKUP}" "${ENV_BACKUP}"
}
trap cleanup EXIT

need_cmd unzip
need_cmd npm
need_cmd pm2

echo "==> zip: ${ZIP_PATH}"
echo "==> app: ${APP_DIR}"

unzip -oq "${ZIP_PATH}" -d "${WORK_DIR}"

if [ ! -f "${WORK_DIR}/client/dist/index.html" ]; then
  echo "ERROR: client/dist/index.html not found in zip." >&2
  exit 1
fi

if [ ! -f "${WORK_DIR}/server/package.json" ]; then
  echo "ERROR: server/package.json not found in zip." >&2
  exit 1
fi

mkdir -p "${APP_DIR}/server"

if [ -d "${APP_DIR}/server/data" ]; then
  echo "==> backup server/data"
  cp -a "${APP_DIR}/server/data/." "${DATA_BACKUP}/"
fi

if [ -f "${APP_DIR}/server/.env" ]; then
  echo "==> backup server/.env"
  cp -a "${APP_DIR}/server/.env" "${ENV_BACKUP}"
fi

echo "==> replace app files"
rm -rf "${APP_DIR}/client"
find "${APP_DIR}/server" -mindepth 1 -maxdepth 1 ! -name data -exec rm -rf {} +

cp -a "${WORK_DIR}/client" "${APP_DIR}/"
cp -a "${WORK_DIR}/server/." "${APP_DIR}/server/"

if [ -f "${ENV_BACKUP}" ]; then
  cp -a "${ENV_BACKUP}" "${APP_DIR}/server/.env"
fi

if [ "$(find "${DATA_BACKUP}" -mindepth 1 -print -quit)" ]; then
  rm -rf "${APP_DIR}/server/data"
  mkdir -p "${APP_DIR}/server/data"
  cp -a "${DATA_BACKUP}/." "${APP_DIR}/server/data/"
fi

echo "==> install server dependencies"
cd "${APP_DIR}"
npm --prefix server install --omit=dev

if [ ! -f "${APP_DIR}/server/.env" ]; then
  echo "==> create MySQL database config"
  MYSQL_DB="${MYSQL_DATABASE:-nav_site}"
  MYSQL_USER_NAME="${MYSQL_USER:-nav_site}"
  MYSQL_PASS="${MYSQL_PASSWORD:-$(openssl rand -hex 16)}"
  cat > "${APP_DIR}/server/.env" <<EOF
PORT=${PORT}
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=${MYSQL_DB}
MYSQL_USER=${MYSQL_USER_NAME}
MYSQL_PASSWORD=${MYSQL_PASS}
MYSQL_CONNECTION_LIMIT=10
MYSQL_MIGRATE_SQLITE=1
EOF
  if command -v mysql >/dev/null 2>&1 && mysql -uroot -e "SELECT 1" >/dev/null 2>&1; then
    mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${MYSQL_USER_NAME}'@'localhost' IDENTIFIED BY '${MYSQL_PASS}';
CREATE USER IF NOT EXISTS '${MYSQL_USER_NAME}'@'127.0.0.1' IDENTIFIED BY '${MYSQL_PASS}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DB}\`.* TO '${MYSQL_USER_NAME}'@'localhost';
GRANT ALL PRIVILEGES ON \`${MYSQL_DB}\`.* TO '${MYSQL_USER_NAME}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
  else
    echo "WARN: mysql root CLI unavailable. Please create database/user from server/.env manually." >&2
  fi
fi

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
