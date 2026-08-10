import { Router } from "express";
import bcrypt from "bcryptjs";
import { get, run } from "../db/index.js";
import { verify as verifyCaptcha } from "../captcha.js";
import { signToken, authMiddleware } from "../middleware/auth.js";
import { wrapAsyncRoutes } from "./async.js";

const router = wrapAsyncRoutes(Router());

const MAX_FAIL = 3;
const LOCK_MS = 60 * 60 * 1000;
const MAX_ACCOUNTS_PER_IP = 3;

function clientIp(req) {
  return (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown").trim();
}

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, adminLevel: u.admin_level || "", nickname: u.nickname || u.username };
}

router.post("/register", async (req, res) => {
  const ip = clientIp(req);
  const { username, password, nickname, captchaToken, captcha } = req.body || {};
  if (!verifyCaptcha(captchaToken, captcha)) return res.status(400).json({ error: "验证码不正确或已过期" });
  if (!username || !password) return res.status(400).json({ error: "请输入用户名和密码" });
  if (await get("SELECT id FROM users WHERE username = ?", [username])) return res.status(400).json({ error: "用户名已存在" });
  const ipUsers = (await get("SELECT COUNT(*) AS c FROM users WHERE register_ip = ?", [ip])).c;
  if (ipUsers >= MAX_ACCOUNTS_PER_IP) return res.status(400).json({ error: "当前地址注册账号数量已达上限" });

  const hash = bcrypt.hashSync(password, 10);
  await run("INSERT INTO users (username, password, role, nickname, register_ip) VALUES (?,?,?,?,?)", [username, hash, "user", nickname || username, ip]);
  const u = await get("SELECT * FROM users WHERE username = ?", [username]);
  res.json({ token: signToken(u), user: publicUser(u) });
});

router.post("/login", async (req, res) => {
  const { username, password, captchaToken, captcha } = req.body || {};
  if (!verifyCaptcha(captchaToken, captcha)) return res.status(400).json({ error: "验证码不正确或已过期" });

  const u = await get("SELECT * FROM users WHERE username = ?", [username]);
  if (u && Number(u.login_locked_until || 0) > Date.now()) {
    const mins = Math.ceil((Number(u.login_locked_until) - Date.now()) / 60000);
    return res.status(429).json({ error: `密码错误次数过多，请 ${mins} 分钟后再登录` });
  }

  if (!u || !bcrypt.compareSync(password || "", u.password)) {
    if (u) {
      const nextCount = Number(u.login_fail_count || 0) + 1;
      if (nextCount >= MAX_FAIL) {
        await run("UPDATE users SET login_fail_count = 0, login_locked_until = ? WHERE id = ?", [Date.now() + LOCK_MS, u.id]);
        return res.status(429).json({ error: "密码错误次数过多，请 60 分钟后再登录" });
      }
      await run("UPDATE users SET login_fail_count = ?, login_locked_until = 0 WHERE id = ?", [nextCount, u.id]);
    }
    return res.status(400).json({ error: "用户名或密码错误" });
  }

  await run("UPDATE users SET login_fail_count = 0, login_locked_until = 0 WHERE id = ?", [u.id]);
  res.json({ token: signToken(u), user: publicUser(u) });
});

router.post("/change-password", authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const u = await get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (u?.role === "admin" && (u.admin_level || "") !== "owner") return res.status(403).json({ error: "limited admin cannot change admin password" });
  if (!u || !bcrypt.compareSync(oldPassword || "", u.password)) return res.status(400).json({ error: "原密码不正确" });
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: "新密码至少 4 位" });
  await run("UPDATE users SET password = ? WHERE id = ?", [bcrypt.hashSync(newPassword, 10), u.id]);
  res.json({ ok: true });
});

router.post("/change-account", authMiddleware, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const oldPassword = req.body?.oldPassword || "";
  const u = await get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (u?.role === "admin" && (u.admin_level || "") !== "owner") return res.status(403).json({ error: "limited admin cannot change admin account" });
  if (!u || !bcrypt.compareSync(oldPassword, u.password)) return res.status(400).json({ error: "原密码不正确" });
  if (!username || username.length < 2) return res.status(400).json({ error: "账号至少 2 位" });
  const exists = await get("SELECT id FROM users WHERE username = ? AND id <> ?", [username, u.id]);
  if (exists) return res.status(400).json({ error: "账号已存在" });
  await run("UPDATE users SET username = ? WHERE id = ?", [username, u.id]);
  const next = await get("SELECT * FROM users WHERE id = ?", [u.id]);
  res.json({ ok: true, token: signToken(next), user: publicUser(next) });
});

router.get("/me", authMiddleware, async (req, res) => {
  const u = await get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!u) return res.status(401).json({ error: "用户不存在" });
  res.json({ user: publicUser(u) });
});

export default router;
