#!/usr/bin/env bash
# 服务器更新脚本：拉代码 + 装后端依赖 + 重启（不在服务器构建，dist 已入库）
set -e

echo "==> git pull"
git pull

echo "==> install server deps"
npm --prefix server install --omit=dev

echo "==> restart pm2"
pm2 restart nav-site || pm2 start server/src/index.js --name nav-site

echo "==> done"
pm2 save
