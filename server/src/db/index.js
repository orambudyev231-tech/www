import { createRequire } from "module";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import initSqlJs from "sql.js";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = join(__dirname, "../../data");
const DB_PATH = join(DATA_DIR, "nav.db");

let SQL = null;
let sqldb = null;
let saveTimer = null;
let dirty = false;

// 写盘防抖：内存即时更新，磁盘最多每 0.8 秒合并写一次
function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, 800);
}

export function flush() {
  if (!dirty || !sqldb) return;
  dirty = false;
  const data = Buffer.from(sqldb.export());
  writeFileSync(DB_PATH, data);
}

// 查询辅助
export function run(sql, params = []) {
  sqldb.run(sql, params);
  scheduleSave();
}

export function all(sql, params = []) {
  const stmt = sqldb.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function get(sql, params = []) {
  const rows = all(sql, params);
  return rows[0] || null;
}

function exec(sql) {
  sqldb.exec(sql);
}

// 容错加列（增量迁移）
function addColumn(table, def) {
  try {
    sqldb.run(`ALTER TABLE ${table} ADD COLUMN ${def}`);
  } catch {
    /* 已存在，忽略 */
  }
}

function createSchema() {
  exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      nickname TEXT,
      nickname_color TEXT DEFAULT '#4f6ef7',
      role_color TEXT DEFAULT '#ef4444',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      page_group TEXT DEFAULT 'home',
      sort INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS sub_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cat_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      sort INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cat_id INTEGER NOT NULL,
      sub TEXT DEFAULT '',
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      domain TEXT,
      descr TEXT DEFAULT '',
      badge TEXT DEFAULT '',
      desc_color TEXT DEFAULT '',
      desc_gradient TEXT DEFAULT '',
      title_color TEXT DEFAULT '',
      badge_color TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      views INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 1,
      sort INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sub_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      descr TEXT DEFAULT '',
      url TEXT NOT NULL,
      domain TEXT,
      badge TEXT DEFAULT 'AD',
      position INTEGER DEFAULT 0,
      desc_gradient TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      visible INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS ad_sub_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      sort INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      sort INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS navs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT DEFAULT '#',
      sort INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content TEXT DEFAULT '',
      visible INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id INTEGER NOT NULL,
      user_id INTEGER,
      nickname TEXT,
      role TEXT DEFAULT '',
      content TEXT NOT NULL,
      image_url TEXT DEFAULT '',
      visible INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      descr TEXT DEFAULT '',
      cat_id INTEGER,
      status TEXT DEFAULT '待审核',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS stats_daily (
      date TEXT PRIMARY KEY,
      pv INTEGER DEFAULT 0,
      uv INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS visit_ips (
      date TEXT NOT NULL,
      ip TEXT NOT NULL,
      PRIMARY KEY (date, ip)
    );
  `);

  // 增量迁移示例（容错）
  addColumn("links", "title_color TEXT DEFAULT ''");
  addColumn("links", "icon TEXT DEFAULT ''");
  addColumn("ads", "icon TEXT DEFAULT ''");
}

function seedIfEmpty() {
  const userCount = get("SELECT COUNT(*) AS c FROM users").c;
  if (userCount === 0) {
    // 默认管理员 admin / admin123
    const hash = bcrypt.hashSync("admin123", 10);
    run(
      "INSERT INTO users (username, password, role, nickname, nickname_color, role_color) VALUES (?,?,?,?,?,?)",
      ["admin", hash, "admin", "管理员", "#4f6ef7", "#ef4444"]
    );
  }

  const catCount = get("SELECT COUNT(*) AS c FROM categories").c;
  if (catCount === 0) {
    const cats = [
      ["日常常用", ["搜索", "效率", "邮箱"]],
      ["AI 工具", ["对话", "绘图", "编程"]],
      ["开发资源", ["代码", "部署", "数据库"]],
      ["影音娱乐", ["视频", "音乐", "图片"]]
    ];
    const catIds = [];
    cats.forEach(([name, subs], i) => {
      run("INSERT INTO categories (name, sort) VALUES (?,?)", [name, i]);
      const id = get("SELECT last_insert_rowid() AS id").id;
      catIds.push(id);
      subs.forEach((s, j) => run("INSERT INTO sub_categories (cat_id, name, sort) VALUES (?,?,?)", [id, s, j]));
    });

    const links = [
      [0, "搜索", "百度", "中文搜索与资讯入口", "https://www.baidu.com", "baidu.com", "热", 128],
      [0, "效率", "飞书", "团队协作、文档和会议", "https://www.feishu.cn", "feishu.cn", "", 75],
      [0, "邮箱", "网易邮箱", "稳定的中文邮箱服务", "https://mail.163.com", "mail.163.com", "", 63],
      [1, "对话", "ChatGPT", "AI 对话、写作和编程助手", "https://chatgpt.com", "openai.com", "AI", 231],
      [1, "绘图", "Midjourney", "高质量 AI 图片创作", "https://www.midjourney.com", "midjourney.com", "", 113],
      [1, "编程", "Codex", "代码协作与自动化实现", "https://openai.com/codex", "openai.com", "新", 92],
      [2, "代码", "GitHub", "代码仓库、Issue 与 Action", "https://github.com", "github.com", "", 188],
      [2, "部署", "1Panel", "服务器面板与 OpenResty 反代", "https://1panel.cn", "1panel.cn", "", 49],
      [2, "数据库", "SQLite", "轻量单文件数据库", "https://sqlite.org", "sqlite.org", "", 59],
      [3, "视频", "哔哩哔哩", "视频社区与学习资源", "https://www.bilibili.com", "bilibili.com", "热", 204],
      [3, "音乐", "网易云音乐", "音乐发现与歌单", "https://music.163.com", "music.163.com", "", 80],
      [3, "图片", "Unsplash", "高质量摄影图库", "https://unsplash.com", "unsplash.com", "", 101]
    ];
    links.forEach(([ci, sub, title, descr, url, domain, badge, views], i) => {
      run(
        "INSERT INTO links (cat_id, sub, title, descr, url, domain, badge, views, sort) VALUES (?,?,?,?,?,?,?,?,?)",
        [catIds[ci], sub, title, descr, url, domain, badge, views, i]
      );
    });

    const ads = [
      ["云服务器特惠", "轻量云主机与 HTTPS 部署", "https://cloud.tencent.com", "cloud.tencent.com", "AD"],
      ["域名防失联", "多域名与中转架构方案", "https://www.cloudflare.com", "cloudflare.com", "HOT"],
      ["代码托管", "GitHub 仓库与自动备份", "https://github.com", "github.com", "NEW"],
      ["开源图标", "抓取与手动上传图标", "https://lucide.dev", "lucide.dev", "UI"],
      ["统计分析", "PV/UV 与访问去重", "https://analytics.google.com", "analytics.google.com", "DATA"]
    ];
    ads.forEach(([title, descr, url, domain, badge], i) =>
      run("INSERT INTO ads (title, descr, url, domain, badge, position) VALUES (?,?,?,?,?,?)", [title, descr, url, domain, badge, i])
    );

    ["本站数据支持后台维护，前台 20 秒轮询兜底刷新", "投稿通过审核后会展示在对应分类", "评论支持验证码与图片上传策略"].forEach(
      (t, i) => run("INSERT INTO notices (text, sort) VALUES (?,?)", [t, i])
    );

    ["首页", "常用工具", "AI 资源", "开发文档", "防失联"].forEach((n, i) =>
      run("INSERT INTO navs (name, url, sort) VALUES (?,?,?)", [n, i === 0 ? "/" : "#", i])
    );

    run("INSERT INTO banners (url, sort) VALUES (?,?)", [
      "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1800&q=80",
      0
    ]);

    run("INSERT INTO pages (name, content) VALUES (?,?)", ["关于本站", "这是一个可后台管理的中文导航网站。"]);
  }

  const settingsCount = get("SELECT COUNT(*) AS c FROM settings").c;
  if (settingsCount === 0) {
    const defaults = {
      title: "1558686 导航站",
      subtitle: "中文精选网站入口",
      logoText: "导",
      searchPlaceholder: "搜索网站、描述或分类",
      footer: "© 1558686 导航站",
      popupEnabled: "1",
      noticeTitle: "站点公告",
      noticeText: "欢迎使用导航站。本站支持分类导航、投稿、评论、后台管理和移动端底部导航。",
      noticeImage: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
      adStyle: "1"
    };
    Object.entries(defaults).forEach(([k, v]) => run("INSERT INTO settings (key, value) VALUES (?,?)", [k, String(v)]));
  }
  flush();
}

export async function initDb() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(join(DATA_DIR, "icons"))) mkdirSync(join(DATA_DIR, "icons"), { recursive: true });
  if (!existsSync(join(DATA_DIR, "uploads"))) mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });

  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  SQL = await initSqlJs({ locateFile: () => wasmPath });

  if (existsSync(DB_PATH)) {
    sqldb = new SQL.Database(readFileSync(DB_PATH));
  } else {
    sqldb = new SQL.Database();
  }

  createSchema();
  seedIfEmpty();

  // 进程退出前刷盘
  const onExit = () => {
    flush();
    process.exit();
  };
  process.on("SIGINT", onExit);
  process.on("SIGTERM", onExit);
  process.on("exit", flush);

  return { run, all, get, flush };
}

export { DATA_DIR, DB_PATH };
