# 导航网站（全栈）

可后台管理的中文导航网站。前台分类卡片 / 广告 / 横幅 / 霓虹跑马灯 / 详情页评论 / 移动端底部导航；
后台链接·分类·广告·页面·颜色·渐变·弹窗公告·访客统计·用户/评论/投稿审核·网站设置等。

## 技术栈
- 前端：React 18 + Vite 5 + react-router-dom 6 + @vitejs/plugin-legacy（兼容老旧浏览器）
- 后端：Node.js + Express 4
- 数据库：sql.js（纯 JS SQLite，单文件 `server/data/nav.db`），写盘防抖（最多每 0.8s 落盘）
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
    routes/      auth.js / public.js / admin.js
    db/index.js  建表、迁移、种子数据、防抖落盘
    captcha.js   图形验证码
    favicon.js   抓取站点图标
    backup.js    数据库自动备份到 GitHub
    events.js    SSE 事件总线
    middleware/auth.js  JWT + requireAdmin
  data/          nav.db / icons / uploads（本地数据，不入库）
update.sh        服务器更新脚本（git pull + 装依赖 + pm2 重启，不 build）
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

## 生产构建 / 部署
```bash
# 本地构建前端（dist 已入库，服务器不再 build）
npm --prefix client run build

# 服务器：单进程同时托管前端 dist 与后端 API
npm --prefix server install --omit=dev
pm2 start server/src/index.js --name nav-site
```
全部由 Express 在 3001 端口提供：`/api/*` 为接口，其余回退到前端 SPA。
1Panel/OpenResty 反代到 `127.0.0.1:3001` + Let's Encrypt HTTPS 即可。

## 数据库备份（可选）
复制 `server/.env.example` 为 `server/.env`，填入带 token 的私有仓库地址与间隔分钟数，
服务运行即定时把 `nav.db` push 到 GitHub；换服务器拉回 `nav.db` 覆盖即可恢复。
