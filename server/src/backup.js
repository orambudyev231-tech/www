import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { tmpdir } from "os";

let lastHash = "";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, stdio: "pipe" });
}

function dumpMysql() {
  const file = join(tmpdir(), "nav-site-mysql.sql");
  const args = [
    `-h${process.env.MYSQL_HOST || "127.0.0.1"}`,
    `-P${process.env.MYSQL_PORT || "3306"}`,
    `-u${process.env.MYSQL_USER || "nav_site"}`,
    "--single-transaction",
    "--quick",
    "--default-character-set=utf8mb4",
    process.env.MYSQL_DATABASE || "nav_site"
  ];
  const env = { ...process.env, MYSQL_PWD: process.env.MYSQL_PASSWORD || "" };
  const sql = execFileSync("mysqldump", args, { env, encoding: "utf8" });
  writeFileSync(file, sql);
  return { file, hash: crypto.createHash("sha1").update(sql).digest("hex") };
}

function runBackup(repo) {
  try {
    const { file, hash } = dumpMysql();
    if (!hash || hash === lastHash) return;
    const dir = join(tmpdir(), "nav-db-backup");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      git(["clone", "--depth", "1", repo, dir]);
    } else {
      git(["pull", "--rebase"], dir);
    }
    copyFileSync(file, join(dir, "nav-site.sql"));
    git(["add", "nav-site.sql"], dir);
    git(["-c", "user.email=backup@nav.site", "-c", "user.name=nav-backup", "commit", "-m", `backup ${new Date().toISOString()}`], dir);
    git(["push"], dir);
    lastHash = hash;
    console.log("[backup] pushed nav-site.sql");
  } catch (e) {
    console.warn("[backup] failed:", e.message);
  }
}

export function startBackup() {
  const repo = process.env.BACKUP_REPO;
  if (!repo) return;

  // 每天固定整点备份（本地时间），如 BACKUP_DAILY_AT=5 表示每天凌晨 5 点
  const dailyAt = process.env.BACKUP_DAILY_AT;
  if (dailyAt !== undefined && dailyAt !== "") {
    const hour = Math.min(23, Math.max(0, Number(dailyAt) || 0));
    const schedule = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      console.log(`[backup] next run: ${next.toLocaleString()}`);
      setTimeout(() => { runBackup(repo); schedule(); }, next - now);
    };
    console.log(`[backup] enabled, daily at ${hour}:00`);
    schedule();
    return;
  }

  const min = Math.max(5, Number(process.env.BACKUP_INTERVAL_MIN) || 60);
  console.log(`[backup] enabled, every ${min} min`);
  setInterval(() => runBackup(repo), min * 60 * 1000);
}
