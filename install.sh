#!/usr/bin/env bash
set -euo pipefail

# 新服务器一键部署：装环境 + 从 GitHub 拉代码 + 建库 + 导入仓库里的备份数据 + pm2 启动
# 用法（root）：
#   apt update && apt install -y git curl
#   git clone https://github.com/orambudyev231-tech/www.git /www/wwwroot/nav-site
#   bash /www/wwwroot/nav-site/install.sh
# 可用环境变量覆盖：APP_DIR / APP_NAME / PORT / REPO_URL / BRANCH / MYSQL_DATABASE / MYSQL_USER / MYSQL_PASSWORD

# 全部逻辑包在 main() 里：脚本先被完整解析再执行，
# 避免执行中 git reset 更新脚本自身导致 bash 读到错乱内容而中断
main() {

APP_DIR="${APP_DIR:-/www/wwwroot/nav-site}"
APP_NAME="${APP_NAME:-nav-site}"
PORT="${PORT:-3001}"
REPO_URL="${REPO_URL:-https://github.com/orambudyev231-tech/www.git}"
BRANCH="${BRANCH:-master}"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: please run as root." >&2
  exit 1
fi

echo "==> install system packages"
apt update
apt install -y curl git

if ! command -v mysql >/dev/null 2>&1; then
  # Ubuntu 用 mysql-server；Debian 没有该包，回退到 MariaDB（协议兼容）
  echo "==> install MySQL/MariaDB server"
  DEBIAN_FRONTEND=noninteractive apt install -y mysql-server \
    || DEBIAN_FRONTEND=noninteractive apt install -y default-mysql-server
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

echo "==> fetch app code: ${REPO_URL} (${BRANCH})"
if [ ! -d "${APP_DIR}/.git" ]; then
  mkdir -p "${APP_DIR}"
  cd "${APP_DIR}"
  git init -b "${BRANCH}"
  git remote add origin "${REPO_URL}"
else
  cd "${APP_DIR}"
  git remote set-url origin "${REPO_URL}"
fi
git fetch origin "${BRANCH}"
git reset --hard "origin/${BRANCH}"

ENV_FILE="${APP_DIR}/server/.env"
touch "${ENV_FILE}"
# .env 可能不存在、为空或不完整（pipefail 下 grep 无匹配是致命错误，必须 || true 兜底）
env_get() { grep "^$1=" "${ENV_FILE}" | tail -1 | cut -d= -f2- || true; }
MYSQL_DB="$(env_get MYSQL_DATABASE)"
MYSQL_USER_NAME="$(env_get MYSQL_USER)"
MYSQL_PASS="$(env_get MYSQL_PASSWORD)"
if [ -z "${MYSQL_DB}" ] || [ -z "${MYSQL_USER_NAME}" ] || [ -z "${MYSQL_PASS}" ]; then
  echo "==> create MySQL database config"
  MYSQL_DB="${MYSQL_DATABASE:-nav_site}"
  MYSQL_USER_NAME="${MYSQL_USER:-nav_site}"
  MYSQL_PASS="${MYSQL_PASSWORD:-$(openssl rand -hex 16)}"
  # 只重写 MySQL 相关行，保留 .env 已有的其他配置（如 BACKUP_*）
  sed -i '/^MYSQL_/d' "${ENV_FILE}"
  grep -q '^PORT=' "${ENV_FILE}" || echo "PORT=${PORT}" >> "${ENV_FILE}"
  cat >> "${ENV_FILE}" <<EOF
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=${MYSQL_DB}
MYSQL_USER=${MYSQL_USER_NAME}
MYSQL_PASSWORD=${MYSQL_PASS}
MYSQL_CONNECTION_LIMIT=10
EOF
fi

if command -v mysql >/dev/null 2>&1 && mysql -uroot -e "SELECT 1" >/dev/null 2>&1; then
  echo "==> ensure database and user"
  mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${MYSQL_USER_NAME}'@'localhost' IDENTIFIED BY '${MYSQL_PASS}';
CREATE USER IF NOT EXISTS '${MYSQL_USER_NAME}'@'127.0.0.1' IDENTIFIED BY '${MYSQL_PASS}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DB}\`.* TO '${MYSQL_USER_NAME}'@'localhost';
GRANT ALL PRIVILEGES ON \`${MYSQL_DB}\`.* TO '${MYSQL_USER_NAME}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

  # 数据库为空且仓库里有备份时，自动导入备份数据
  TABLE_COUNT="$(mysql -uroot -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${MYSQL_DB}'")"
  if [ "${TABLE_COUNT}" = "0" ] && [ -f "${APP_DIR}/nav-site.sql" ]; then
    echo "==> restore backup data from nav-site.sql"
    mysql -uroot "${MYSQL_DB}" < "${APP_DIR}/nav-site.sql"
  elif [ "${TABLE_COUNT}" != "0" ]; then
    echo "==> database already has ${TABLE_COUNT} tables, skip restore"
  else
    echo "==> no nav-site.sql in repo, start with fresh seed data"
  fi
else
  echo "WARN: mysql root CLI unavailable. Create database/user from server/.env manually, then import nav-site.sql." >&2
fi

echo "==> install server dependencies"
npm --prefix "${APP_DIR}/server" install --omit=dev

echo "==> start pm2"
cd "${APP_DIR}"
PORT="${PORT}" pm2 restart "${APP_NAME}" --update-env 2>/dev/null || PORT="${PORT}" pm2 start server/src/index.js --name "${APP_NAME}"
pm2 startup || true
pm2 save

echo "==> health check"
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health"; then
    echo
    break
  fi
  if [ "${i}" -eq 20 ]; then
    echo
    echo "WARN: health check failed. Check logs: pm2 logs ${APP_NAME} --lines 80" >&2
    break
  fi
  sleep 1
done

echo "==> install complete"
echo "App directory: ${APP_DIR}"
echo "Site: http://<服务器IP>:${PORT} （建议再配反向代理 + HTTPS）"
echo "提示：如需自动备份，在 ${APP_DIR}/server/.env 追加 BACKUP_REPO（含令牌）与 BACKUP_DAILY_AT=5 后 pm2 restart ${APP_NAME} --update-env"

}
main "$@"
