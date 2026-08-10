# 导航网站（全栈）

可后台管理的中文导航网站。前台分类卡片 / 广告 / 横幅 / 霓虹跑马灯 / 详情页评论 / 移动端底部导航；
后台链接·分类·广告·页面·颜色·渐变·弹窗公告·访客统计·用户/评论/投稿审核·网站设置等。

## 技术栈
- 前端：React 18 + Vite 5 + react-router-dom 6 + @vitejs/plugin-legacy（兼容老旧浏览器）
- 后端：Node.js + Express 4
- 数据库：MySQL / MariaDB（mysql2 连接池）；旧版 SQLite `nav.db` 存在且库为空时首次启动自动迁移
- 鉴权：JWT（7 天）+ bcryptjs；后台接口 `requireAdmin`
- 实时：SSE（`/api/events`）+ 前端 20 秒轮询兜底
- 图形验证码：服务端生成 SVG，内存存储、5 分钟过期、一次性、大小写不敏感

## 目录结构
```
client/          前端
  src/
    App.jsx      路由 + 前台页面 + 后台所有管理页
    api.js       接口封装（JWT 存 localStorage:nav_token）
  dist/          构建产物（入库，服务器免构建）
  vite.config.js dev 代理到后端 3001
server/          后端
  src/
    index.js     入口：静态资源 + SSE + 路由 + 托管 client/dist
    routes/      auth.js / public.js / admin.js / async.js
    db/index.js  建表、迁移、种子数据
    captcha.js   图形验证码
    favicon.js   抓取站点图标
    backup.js    数据库定时备份推送到 GitHub（mysqldump）
    events.js    SSE 事件总线
    middleware/auth.js  JWT + requireAdmin
  data/          icons / uploads（本地数据，不入库）
install.sh       新服务器一键部署（装环境 + 拉代码 + 建库 + 恢复备份 + pm2）
update.sh        服务器更新脚本（git 拉取 + 装依赖 + pm2 重启，不 build）
部署步骤.txt      详细部署文档
```

## 本地开发
```bash
# 1) 装依赖
npm --prefix server install
npm --prefix client install

# 2) 起后端（默认 3001）
npm --prefix server start

# 3) 起前端（另开终端，dev 代理到 3001）
npm --prefix client run dev
```
打开 http://127.0.0.1:5173 。默认管理员 **admin / admin123**（首次登录后请改密码）。

## 生产部署（详见《部署步骤.txt》）

新服务器三条命令（Ubuntu / Debian，root）：
```bash
apt update && apt install -y git curl
git clone https://github.com/orambudyev231-tech/www.git /www/wwwroot/nav-site
bash /www/wwwroot/nav-site/install.sh
```
`install.sh` 自动装 MySQL(/MariaDB)、Node 20、pm2，建库建用户，
仓库里有 `nav-site.sql` 备份且库为空时**自动恢复数据**，最后 pm2 启动 + 开机自启。

日常更新（本地推送仓库后在服务器执行）：
```bash
bash /www/wwwroot/nav-site/update.sh
```
全部由 Express 在 3001 端口提供：`/api/*` 为接口，其余回退到前端 SPA。
1Panel/OpenResty 反代到 `127.0.0.1:3001` + Let's Encrypt HTTPS 即可。

本地改前端后记得构建再提交（dist 入库，服务器免 build）：
```bash
npm --prefix client run build
```

## 数据库自动备份
在 `server/.env` 配置（token 需有仓库写权限）：
```
BACKUP_REPO=https://<token>@github.com/orambudyev231-tech/www.git
BACKUP_DAILY_AT=5        # 每天凌晨 5 点（本地时间）
#BACKUP_INTERVAL_MIN=60  # 或按间隔（分钟），仅在未设 DAILY_AT 时生效
#BACKUP_RUN_ON_START=1   # 启动即备份一次（验证用，验证后删除）
```
服务运行时定时 `mysqldump` 全库并把 `nav-site.sql` 推送到仓库根目录；
内容无变化自动跳过。只在一台服务器上开启，避免多机互相覆盖。
恢复：`mysql -uroot nav_site < nav-site.sql`，或直接在新机跑 `install.sh` 自动恢复。
