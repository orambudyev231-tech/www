import { createRequire } from "module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = join(__dirname, "../../data");
export let DB_PATH = "mysql";
const SQLITE_PATH = join(DATA_DIR, "nav.db");

let pool;
let sqliteDb;

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function dbConfig(withDatabase = true) {
  const database = env("MYSQL_DATABASE", "nav_site");
  return {
    host: env("MYSQL_HOST", "127.0.0.1"),
    port: Number(env("MYSQL_PORT", "3306")),
    user: env("MYSQL_USER", "nav_site"),
    password: env("MYSQL_PASSWORD", ""),
    database: withDatabase ? database : undefined,
    waitForConnections: true,
    connectionLimit: Number(env("MYSQL_CONNECTION_LIMIT", "10")),
    charset: "utf8mb4",
    timezone: "+08:00",
    multipleStatements: false
  };
}

async function exec(sql) {
  if (sqliteDb) {
    sqliteDb.run(toSqliteSql(sql));
    persistSqlite();
    return;
  }
  await pool.query(sql);
}

export async function run(sql, params = []) {
  if (sqliteDb) {
    const stmt = sqliteDb.prepare(toSqliteSql(sql));
    try {
      stmt.bind(params);
      while (stmt.step()) {}
    } finally {
      stmt.free();
    }
    const meta = sqliteDb.exec("SELECT last_insert_rowid() AS insertId, changes() AS affectedRows")?.[0];
    persistSqlite();
    return Object.fromEntries(meta.columns.map((c, i) => [c, meta.values[0][i]]));
  }
  const [result] = await pool.execute(sql, params);
  return result;
}

export async function all(sql, params = []) {
  if (sqliteDb) {
    const stmt = sqliteDb.prepare(toSqliteSql(sql));
    const rows = [];
    try {
      stmt.bind(params);
      while (stmt.step()) rows.push(stmt.getAsObject());
    } finally {
      stmt.free();
    }
    return rows;
  }
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

export async function flush() {
  if (sqliteDb) persistSqlite();
  return true;
}

function toSqliteSql(sql) {
  return sql
    .replace(
      /INSERT INTO stats_daily \(date, pv, uv\) VALUES \(\?,1,0\) ON DUPLICATE KEY UPDATE pv = pv \+ 1/i,
      "INSERT INTO stats_daily (date, pv, uv) VALUES (?,1,0) ON CONFLICT(date) DO UPDATE SET pv = pv + 1"
    )
    .replace(
      /INSERT INTO settings \(`key`, value\) VALUES \(\?,\?\) ON DUPLICATE KEY UPDATE value = VALUES\(value\)/i,
      "INSERT INTO settings (`key`, value) VALUES (?,?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value"
    )
    .replace(/\bINSERT IGNORE INTO\b/gi, "INSERT OR IGNORE INTO");
}

function persistSqlite() {
  if (!sqliteDb) return;
  writeFileSync(SQLITE_PATH, Buffer.from(sqliteDb.export()));
}

async function initSqliteDb() {
  if (!existsSync(SQLITE_PATH)) throw new Error(`SQLite database not found: ${SQLITE_PATH}`);
  const { default: initSqlJs } = await import("sql.js");
  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  sqliteDb = new SQL.Database(readFileSync(SQLITE_PATH));
  DB_PATH = SQLITE_PATH;
  // sqlite 路径不走 createSchema，新增列需要在这里补齐
  await addColumn("links", "icon_size INT DEFAULT 0");
  console.log(`[sqlite] connected ${SQLITE_PATH}`);
  return { run, all, get, flush };
}

async function addColumn(table, def) {
  try {
    await exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
  } catch (e) {
    // mysql 用错误码；sqlite (sql.js) 只有 message
    if (!["ER_DUP_FIELDNAME", "ER_DUP_KEYNAME"].includes(e.code) && !/duplicate column/i.test(e.message || "")) throw e;
  }
}

async function createDatabase() {
  const cfg = dbConfig(false);
  const database = env("MYSQL_DATABASE", "nav_site").replace(/`/g, "");
  let conn;
  try {
    conn = await mysql.createConnection(cfg);
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (e) {
    if (!["ER_DBACCESS_DENIED_ERROR", "ER_ACCESS_DENIED_ERROR"].includes(e.code)) throw e;
  } finally {
    await conn?.end();
  }
}

async function createSchema() {
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(191) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(32) DEFAULT 'user',
      admin_level VARCHAR(32) DEFAULT '',
      nickname VARCHAR(191) DEFAULT '',
      nickname_color VARCHAR(32) DEFAULT '#4f6ef7',
      role_color VARCHAR(32) DEFAULT '#ef4444',
      register_ip VARCHAR(100) DEFAULT '',
      login_fail_count INT DEFAULT 0,
      login_locked_until BIGINT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      page_group VARCHAR(64) DEFAULT 'home',
      sort INT DEFAULT 0,
      visible TINYINT DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS sub_categories (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      cat_id INT UNSIGNED NOT NULL,
      name VARCHAR(191) NOT NULL,
      sort INT DEFAULT 0,
      INDEX idx_sub_categories_cat (cat_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS links (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      cat_id INT UNSIGNED NULL,
      sub VARCHAR(191) DEFAULT '',
      title VARCHAR(191) NOT NULL,
      url VARCHAR(500) NOT NULL,
      domain VARCHAR(191) DEFAULT '',
      descr VARCHAR(500) DEFAULT '',
      badge VARCHAR(64) DEFAULT '',
      desc_color VARCHAR(32) DEFAULT '',
      desc_gradient TEXT NULL,
      title_color VARCHAR(32) DEFAULT '',
      badge_color VARCHAR(32) DEFAULT '',
      icon VARCHAR(500) DEFAULT '',
      views INT DEFAULT 0,
      visible TINYINT DEFAULT 1,
      sort INT DEFAULT 0,
      INDEX idx_links_cat (cat_id),
      INDEX idx_links_visible_sort (visible, sort, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS sub_links (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      link_id INT UNSIGNED NOT NULL,
      title VARCHAR(191) NOT NULL,
      url VARCHAR(500) NOT NULL,
      INDEX idx_sub_links_link (link_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS ads (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(191) NOT NULL,
      descr VARCHAR(500) DEFAULT '',
      url VARCHAR(500) NOT NULL,
      domain VARCHAR(191) DEFAULT '',
      badge VARCHAR(64) DEFAULT 'AD',
      position INT DEFAULT 0,
      desc_gradient TEXT NULL,
      icon VARCHAR(500) DEFAULT '',
      visible TINYINT DEFAULT 1,
      title_color VARCHAR(32) DEFAULT '',
      desc_color VARCHAR(32) DEFAULT '',
      badge_color VARCHAR(32) DEFAULT '',
      INDEX idx_ads_visible_position (visible, position, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS ad_sub_links (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ad_id INT UNSIGNED NOT NULL,
      title VARCHAR(191) NOT NULL,
      url VARCHAR(500) NOT NULL,
      INDEX idx_ad_sub_links_ad (ad_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS banners (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      url VARCHAR(500) NOT NULL,
      sort INT DEFAULT 0,
      visible TINYINT DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS notices (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      text VARCHAR(500) NOT NULL,
      url VARCHAR(500) DEFAULT '',
      color VARCHAR(32) DEFAULT '#334155',
      sort INT DEFAULT 0,
      visible TINYINT DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS navs (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      url VARCHAR(500) DEFAULT '#',
      sort INT DEFAULT 0,
      visible TINYINT DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      content TEXT NULL,
      visible TINYINT DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\` VARCHAR(191) NOT NULL PRIMARY KEY,
      value TEXT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      link_id INT UNSIGNED NOT NULL,
      user_id INT UNSIGNED NULL,
      nickname VARCHAR(191) DEFAULT '',
      role VARCHAR(32) DEFAULT '',
      content TEXT NOT NULL,
      image_url VARCHAR(500) DEFAULT '',
      visible TINYINT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_comments_link (link_id, visible, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NULL,
      title VARCHAR(191) NOT NULL,
      url VARCHAR(500) NOT NULL,
      descr VARCHAR(500) DEFAULT '',
      cat_id INT UNSIGNED NULL,
      status VARCHAR(64) DEFAULT '待审核',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS stats_daily (
      date DATE NOT NULL PRIMARY KEY,
      pv INT DEFAULT 0,
      uv INT DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS visit_ips (
      date DATE NOT NULL,
      ip VARCHAR(100) NOT NULL,
      PRIMARY KEY (date, ip)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS visit_logs (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      date DATE NOT NULL,
      ip VARCHAR(100) NOT NULL,
      path VARCHAR(300) DEFAULT '/',
      referer VARCHAR(500) DEFAULT '',
      user_agent VARCHAR(500) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_visit_logs_id (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumn("links", "icon_size INT DEFAULT 0");
  await addColumn("ads", "title_color VARCHAR(32) DEFAULT ''");
  await addColumn("ads", "desc_color VARCHAR(32) DEFAULT ''");
  await addColumn("ads", "badge_color VARCHAR(32) DEFAULT ''");
  await addColumn("notices", "url VARCHAR(500) DEFAULT ''");
  await addColumn("notices", "color VARCHAR(32) DEFAULT '#334155'");
  await addColumn("users", "admin_level VARCHAR(32) DEFAULT ''");
  await run("UPDATE users SET admin_level = 'owner' WHERE role = 'admin' AND (admin_level IS NULL OR admin_level = '')");
}

async function seedIfEmpty() {
  const userCount = Number((await get("SELECT COUNT(*) AS c FROM users"))?.c || 0);
  if (userCount === 0) {
    const hash = bcrypt.hashSync("admin123", 10);
    await run(
      "INSERT INTO users (username, password, role, admin_level, nickname, nickname_color, role_color) VALUES (?,?,?,?,?,?,?)",
      ["admin", hash, "admin", "owner", "管理员", "#4f6ef7", "#ef4444"]
    );
  }

  const catCount = Number((await get("SELECT COUNT(*) AS c FROM categories"))?.c || 0);
  if (catCount === 0) {
    const cats = [
      ["日常", ["搜索", "效率", "邮箱"]],
      ["AI 工具", ["对话", "绘图", "编程"]],
      ["开发资源", ["代码", "部署", "数据库"]],
      ["影音娱乐", ["视频", "音乐", "图片"]]
    ];
    const catIds = [];
    for (let i = 0; i < cats.length; i++) {
      const [name, subs] = cats[i];
      const result = await run("INSERT INTO categories (name, sort) VALUES (?,?)", [name, i]);
      catIds.push(result.insertId);
      for (let j = 0; j < subs.length; j++) {
        await run("INSERT INTO sub_categories (cat_id, name, sort) VALUES (?,?,?)", [result.insertId, subs[j], j]);
      }
    }

    const links = [
      [0, "搜索", "百度", "中文搜索与资讯入口", "https://www.baidu.com", "baidu.com", "热", 128],
      [0, "效率", "飞书", "团队协作、文档和会议", "https://www.feishu.cn", "feishu.cn", "", 75],
      [0, "邮箱", "网易邮箱", "稳定的中文邮箱服务", "https://mail.163.com", "mail.163.com", "", 63],
      [1, "对话", "ChatGPT", "AI 对话、写作和编程助手", "https://chatgpt.com", "openai.com", "AI", 231],
      [1, "绘图", "Midjourney", "高质量 AI 图片创作", "https://www.midjourney.com", "midjourney.com", "", 113],
      [1, "编程", "Codex", "代码协作与自动化实现", "https://openai.com/codex", "openai.com", "新", 92],
      [2, "代码", "GitHub", "代码仓库、Issue 和 Action", "https://github.com", "github.com", "", 188],
      [2, "部署", "1Panel", "服务器面板与 OpenResty 反代", "https://1panel.cn", "1panel.cn", "", 49],
      [2, "数据库", "MySQL", "生产环境常用关系型数据库", "https://www.mysql.com", "mysql.com", "", 59],
      [3, "视频", "哔哩哔哩", "视频社区与学习资源", "https://www.bilibili.com", "bilibili.com", "热", 204],
      [3, "音乐", "网易云音乐", "音乐发现与歌单", "https://music.163.com", "music.163.com", "", 80],
      [3, "图片", "Unsplash", "高质量摄影图库", "https://unsplash.com", "unsplash.com", "", 101]
    ];
    for (let i = 0; i < links.length; i++) {
      const [ci, sub, title, descr, url, domain, badge, views] = links[i];
      await run(
        "INSERT INTO links (cat_id, sub, title, descr, url, domain, badge, views, sort) VALUES (?,?,?,?,?,?,?,?,?)",
        [catIds[ci], sub, title, descr, url, domain, badge, views, i]
      );
    }

    const ads = [
      ["云服务器特惠", "轻量云主机与 HTTPS 部署", "https://cloud.tencent.com", "cloud.tencent.com", "AD"],
      ["域名防失联", "多域名与中转架构方案", "https://www.cloudflare.com", "cloudflare.com", "HOT"],
      ["代码托管", "GitHub 仓库与自动备份", "https://github.com", "github.com", "NEW"],
      ["开源图标", "抓取与手动上传图标", "https://lucide.dev", "lucide.dev", "UI"],
      ["统计分析", "PV/UV 与访问去重", "https://analytics.google.com", "analytics.google.com", "DATA"]
    ];
    for (let i = 0; i < ads.length; i++) {
      const [title, descr, url, domain, badge] = ads[i];
      await run("INSERT INTO ads (title, descr, url, domain, badge, position) VALUES (?,?,?,?,?,?)", [title, descr, url, domain, badge, i]);
    }

    for (const [i, text] of [
      "本站数据支持后台维护，前台 20 秒轮询兜底刷新",
      "投稿通过审核后会展示在对应分类",
      "评论支持验证码与图片上传策略"
    ].entries()) {
      await run("INSERT INTO notices (text, sort) VALUES (?,?)", [text, i]);
    }

    for (const [i, name] of ["首页", "常用工具", "AI 资源", "开发文档", "防失联"].entries()) {
      await run("INSERT INTO navs (name, url, sort) VALUES (?,?,?)", [name, i === 0 ? "/" : "#", i]);
    }

    await run("INSERT INTO banners (url, sort) VALUES (?,?)", [
      "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1800&q=80",
      0
    ]);
    await run("INSERT INTO pages (name, content) VALUES (?,?)", ["关于本站", "这是一个可后台管理的中文导航网站。"]);
  }

  const settingsCount = Number((await get("SELECT COUNT(*) AS c FROM settings"))?.c || 0);
  if (settingsCount === 0) {
    const defaults = {
      title: "导航站",
      subtitle: "中文精选网站入口",
      logoText: "导",
      searchPlaceholder: "搜索网站、描述或分类",
      footer: "© 1558686 导航站",
      popupEnabled: "1",
      noticeTitle: "站点公告",
      noticeText: "欢迎使用导航站。本站支持分类导航、投稿、评论、后台管理和移动端底部导航。",
      noticeImage: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
      noticeTgUrl: "",
      noticeTgText: "TG联系",
      adStyle: "1",
      frontTheme: "current"
    };
    for (const [k, v] of Object.entries(defaults)) {
      await run("INSERT INTO settings (`key`, value) VALUES (?,?)", [k, String(v)]);
    }
  }
}

async function migrateSqliteIfNeeded() {
  if (process.env.MYSQL_MIGRATE_SQLITE === "0" || !existsSync(SQLITE_PATH)) return;
  const catCount = Number((await get("SELECT COUNT(*) AS c FROM categories"))?.c || 0);
  if (catCount > 0) return;

  const { default: initSqlJs } = await import("sql.js");
  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const sqlite = new SQL.Database(readFileSync(SQLITE_PATH));

  const tableOrder = [
    "users",
    "categories",
    "sub_categories",
    "links",
    "sub_links",
    "ads",
    "ad_sub_links",
    "banners",
    "notices",
    "navs",
    "pages",
    "settings",
    "comments",
    "submissions",
    "stats_daily",
    "visit_ips",
    "visit_logs"
  ];

  const mysqlColumns = {};
  for (const table of tableOrder) {
    mysqlColumns[table] = new Set((await all(`SHOW COLUMNS FROM ${table}`)).map((c) => c.Field));
  }

  function sqliteAll(sql) {
    const stmt = sqlite.prepare(sql);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  const sqliteTables = new Set(sqliteAll("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name));
  for (const table of tableOrder) {
    if (!sqliteTables.has(table)) continue;
    const rows = sqliteAll(`SELECT * FROM ${table}`);
    for (const row of rows) {
      const cols = Object.keys(row).filter((c) => mysqlColumns[table].has(c));
      if (!cols.length) continue;
      const names = cols.map((c) => `\`${c}\``).join(",");
      const marks = cols.map(() => "?").join(",");
      await run(`INSERT IGNORE INTO ${table} (${names}) VALUES (${marks})`, cols.map((c) => row[c]));
    }
  }

  sqlite.close();
  console.log(`[mysql] migrated sqlite data from ${SQLITE_PATH}`);
}

export async function initDb() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(join(DATA_DIR, "icons"))) mkdirSync(join(DATA_DIR, "icons"), { recursive: true });
  if (!existsSync(join(DATA_DIR, "uploads"))) mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });

  if (process.env.DB_DRIVER === "sqlite") return initSqliteDb();

  try {
    await createDatabase();
    pool = mysql.createPool(dbConfig(true));
    await createSchema();
    await migrateSqliteIfNeeded();
    await seedIfEmpty();
    console.log(`[mysql] connected ${env("MYSQL_HOST", "127.0.0.1")}:${env("MYSQL_PORT", "3306")}/${env("MYSQL_DATABASE", "nav_site")}`);
    return { run, all, get, flush };
  } catch (e) {
    if (!existsSync(SQLITE_PATH)) throw e;
    console.warn(`[mysql] unavailable (${e.code || e.message}); falling back to sqlite preview`);
    await pool?.end?.().catch(() => {});
    pool = null;
    return initSqliteDb();
  }
}
