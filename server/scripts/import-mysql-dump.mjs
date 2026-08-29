// 把根目录的 MySQL dump（nav-site.sql）导入为 SQLite（server/data/nav.db），
// 供本地无 MySQL 时的 sqlite 回退预览使用。
// 用法：node server/scripts/import-mysql-dump.mjs [dump.sql] [out.db]
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const dumpPath = process.argv[2] || join(__dirname, "../../nav-site.sql");
const outPath = process.argv[3] || join(__dirname, "../data/nav.db");

const raw = readFileSync(dumpPath, "utf8");

// 按语句切分：跟踪字符串/反引号状态，遇到裸分号才断句
function splitStatements(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  let inStr = null; // ' 或 " 或 `
  while (i < sql.length) {
    const ch = sql[i];
    if (inStr) {
      cur += ch;
      if (ch === "\\" && inStr !== "`") {
        cur += sql[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      cur += ch;
      i++;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-" && (i === 0 || sql[i - 1] === "\n")) {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (ch === ";") {
      const s = cur.trim();
      if (s) out.push(s);
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  const s = cur.trim();
  if (s) out.push(s);
  return out;
}

// MySQL 字符串转 SQLite：\' -> ''，\\ -> \，\n 等转实际字符
function convertStrings(stmt) {
  let out = "";
  let i = 0;
  let inStr = null;
  const esc = { n: "\n", r: "\r", t: "\t", "0": "\0", Z: "\x1a", b: "\b" };
  while (i < stmt.length) {
    const ch = stmt[i];
    if (inStr === "'") {
      if (ch === "\\") {
        const nx = stmt[i + 1];
        if (nx === "'") out += "''";
        else if (nx === '"') out += '"';
        else if (nx === "\\") out += "\\";
        else if (nx in esc) out += esc[nx];
        else out += nx ?? "";
        i += 2;
        continue;
      }
      if (ch === "'") {
        // MySQL 里 '' 也是转义的单引号，SQLite 相同，原样保留
        inStr = stmt[i + 1] === "'" ? "'" : null;
        out += ch;
        if (inStr) {
          out += "'";
          i += 2;
          continue;
        }
        i++;
        continue;
      }
      out += ch;
      i++;
      continue;
    }
    if (ch === "'") inStr = "'";
    out += ch;
    i++;
  }
  return out;
}

// CREATE TABLE 的 MySQL 语法清洗成 SQLite 可接受的形式
function convertCreate(stmt) {
  let s = stmt;
  s = s.replace(/\)\s*ENGINE=[^;]*$/i, ")");
  s = s.replace(/CHARACTER SET \w+/gi, "");
  s = s.replace(/COLLATE[= ]\w+/gi, "");
  s = s.replace(/AUTO_INCREMENT=\d+/gi, "");
  s = s.replace(/\bunsigned\b/gi, "");
  s = s.replace(/\bAUTO_INCREMENT\b/gi, "");
  // SQLite 只有 INTEGER 类型的主键才能自增（rowid 别名）
  s = s.replace(/\b(big|medium|small|tiny)?int\b(\(\d+\))?/gi, "INTEGER");
  s = s.replace(/ON UPDATE CURRENT_TIMESTAMP(\(\d*\))?/gi, "");
  s = s.replace(/DEFAULT CURRENT_TIMESTAMP(\(\d*\))?/gi, "DEFAULT (datetime('now','localtime'))");
  // 去掉二级索引/唯一键行（保留 PRIMARY KEY；UNIQUE KEY 转为表级 UNIQUE）
  s = s.replace(/,\s*UNIQUE KEY\s+`?\w+`?\s*(\([^)]*\))/gi, ", UNIQUE $1");
  s = s.replace(/,\s*(FULLTEXT\s+)?KEY\s+`?\w+`?\s*\([^)]*\)/gi, "");
  s = s.replace(/,\s*CONSTRAINT[^,)]*\([^)]*\)[^,)]*(\([^)]*\))?[^,)]*/gi, "");
  return s;
}

async function main() {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const stmts = splitStatements(raw);
  let created = 0, inserted = 0, skipped = 0;
  for (const st of stmts) {
    const head = st.slice(0, 30).toUpperCase();
    try {
      if (head.startsWith("CREATE TABLE")) {
        db.run(convertCreate(st));
        created++;
      } else if (head.startsWith("INSERT INTO")) {
        db.run(convertStrings(st));
        inserted++;
      } else if (head.startsWith("DROP TABLE")) {
        db.run(st);
      } else {
        skipped++;
      }
    } catch (e) {
      console.error(`失败: ${st.slice(0, 80)}...\n  ${e.message}`);
      process.exitCode = 1;
    }
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(db.export()));
  const rows = db.exec("SELECT (SELECT COUNT(*) FROM links) AS links, (SELECT COUNT(*) FROM categories) AS cats, (SELECT COUNT(*) FROM users) AS users");
  console.log(`表 ${created} 张，INSERT ${inserted} 条，跳过 ${skipped} 条 -> ${outPath}`);
  console.log("行数检查:", JSON.stringify(rows?.[0]));
}

main();
