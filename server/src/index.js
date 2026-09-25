import express from "express";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { initDb, DATA_DIR } from "./db/index.js";
import { addClient } from "./events.js";
import { startBackup } from "./backup.js";
import authRoutes from "./routes/auth.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 加载 server/.env（无第三方依赖）
function loadEnv() {
  const envPath = join(__dirname, "../.env");
  if (!existsSync(envPath)) return;
  readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
}
loadEnv();

const PORT = process.env.PORT || 3001;

// 当前部署的 git 提交号（/api/health 返回，方便核对服务器是否更新到位）
function readVersion() {
  try {
    const gitDir = join(__dirname, "../../.git");
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    const m = /^ref: (.+)$/.exec(head);
    const sha = m ? readFileSync(join(gitDir, m[1]), "utf8").trim() : head;
    return sha.slice(0, 7);
  } catch {
    return "unknown";
  }
}
const APP_VERSION = readVersion();

async function main() {
  await initDb();

  const app = express();
  app.use(cors()); // CORS:* —— 换域名/经中转都正常
  app.use(express.json({ limit: "2mb" }));

  // 静态资源：图标、上传图片
  app.use("/icons", express.static(join(DATA_DIR, "icons")));
  app.use("/uploads", express.static(join(DATA_DIR, "uploads")));

  // SSE 实时推送
  app.get("/api/events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.flushHeaders?.();
    res.write(": connected\n\n");
    addClient(res);
  });

  // 路由
  app.use("/api/auth", authRoutes);
  app.use("/api/public", publicRoutes);
  app.use("/api/admin", adminRoutes);

  app.get("/api/health", (req, res) => res.json({ ok: true, time: Date.now(), version: APP_VERSION }));

  app.use((err, req, res, next) => {
    console.error("[api error]", err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "server error" });
  });

  // 前端构建产物（dist 已入库，服务器免构建）
  const distDir = join(__dirname, "../../client/dist");
  if (existsSync(distDir)) {
    // index.html 禁缓存（每次都取最新，更新立即生效）；带 hash 的 assets 缓存 30 天
    app.use(express.static(distDir, {
      index: false,
      maxAge: "30d",
      setHeaders: (res, path) => { if (path.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); }
    }));
    // SPA 回退
    app.get(/^(?!\/api).*/, (req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(join(distDir, "index.html"));
    });
  }

  startBackup();

  app.listen(PORT, () => console.log(`[nav-site] server on http://127.0.0.1:${PORT}`));
}

main().catch((e) => {
  console.error("启动失败:", e);
  process.exit(1);
});
