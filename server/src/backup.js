import { execFileSync } from "child_process";
import { existsSync, mkdirSync, copyFileSync, readFileSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { tmpdir } from "os";
import { DB_PATH, flush } from "./db/index.js";

// 数据库自动备份到 GitHub 私有仓库
// server/.env: BACKUP_REPO=https://<token>@github.com/<user>/nav-db-backup.git  BACKUP_INTERVAL_MIN=60
let lastHash = "";

function hashDb() {
  if (!existsSync(DB_PATH)) return "";
  return crypto.createHash("sha1").update(readFileSync(DB_PATH)).digest("hex");
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, stdio: "pipe" });
}

function runBackup(repo) {
  flush();
  const h = hashDb();
  if (!h || h === lastHash) return; // 无变化跳过
  const dir = join(tmpdir(), "nav-db-backup");
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      git(["clone", "--depth", "1", repo, dir]);
    } else {
      git(["pull", "--rebase"], dir);
    }
    copyFileSync(DB_PATH, join(dir, "nav.db"));
    git(["add", "nav.db"], dir);
    git(["-c", "user.email=backup@nav.site", "-c", "user.name=nav-backup", "commit", "-m", `backup ${new Date().toISOString()}`], dir);
    git(["push"], dir);
    lastHash = h;
    console.log("[backup] pushed nav.db");
  } catch (e) {
    console.warn("[backup] failed:", e.message);
  }
}

export function startBackup() {
  const repo = process.env.BACKUP_REPO;
  if (!repo) return;
  const min = Math.max(5, Number(process.env.BACKUP_INTERVAL_MIN) || 60);
  console.log(`[backup] enabled, every ${min} min`);
  setInterval(() => runBackup(repo), min * 60 * 1000);
}
