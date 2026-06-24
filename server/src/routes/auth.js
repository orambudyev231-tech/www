import { Router } from "express";
import bcrypt from "bcryptjs";
import { all, get, run } from "../db/index.js";
import { verify as verifyCaptcha } from "../captcha.js";
import { signToken, authMiddleware } from "../middleware/auth.js";

const router = Router();

// 登录失败按 IP 锁定（15 分钟，5 次）
const fails = new Map(); // ip -> { count, until }
const MAX_FAIL = 5;
const LOCK_MS = 15 * 60 * 1000;

function clientIp(req) {
  return (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown").trim();
}

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, nickname: u.nickname || u.username };
}

router.post("/register", (req, res) => {
  const { username, password, nickname, captchaToken, captcha } = req.body || {};
  if (!verifyCaptcha(captchaToken, captcha)) return res.status(400).json({ error: "验证码不正确或已过期" });
  if (!username || !password) return res.status(400).json({ error: "请输入用户名和密码" });
  if (get("SELECT id FROM users WHERE username = ?", [username])) return res.status(400).json({ error: "用户名已存在" });

  const hash = bcrypt.hashSync(password, 10);
  run("INSERT INTO users (username, password, role, nickname) VALUES (?,?,?,?)", [username, hash, "user", nickname || username]);
  const u = get("SELECT * FROM users WHERE username = ?", [username]);
  res.json({ token: signToken(u), user: publicUser(u) });
});

router.post("/login", (req, res) => {
  const ip = clientIp(req);
  const lock = fails.get(ip);
  if (lock && lock.until > Date.now()) {
    const mins = Math.ceil((lock.until - Date.now()) / 60000);
    return res.status(429).json({ error: `登录失败次数过多，请 ${mins} 分钟后再试` });
  }

  const { username, password, captchaToken, captcha } = req.body || {};
  if (!verifyCaptcha(captchaToken, captcha)) return res.status(400).json({ error: "验证码不正确或已过期" });

  const u = get("SELECT * FROM users WHERE username = ?", [username]);
  if (!u || !bcrypt.compareSync(password || "", u.password)) {
    const cur = fails.get(ip) || { count: 0, until: 0 };
    cur.count += 1;
    if (cur.count >= MAX_FAIL) {
      cur.until = Date.now() + LOCK_MS;
      cur.count = 0;
    }
    fails.set(ip, cur);
    return res.status(400).json({ error: "用户名或密码错误" });
  }

  fails.delete(ip);
  res.json({ token: signToken(u), user: publicUser(u) });
});

router.post("/change-password", authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const u = get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!u || !bcrypt.compareSync(oldPassword || "", u.password)) return res.status(400).json({ error: "原密码不正确" });
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: "新密码至少 4 位" });
  run("UPDATE users SET password = ? WHERE id = ?", [bcrypt.hashSync(newPassword, 10), u.id]);
  res.json({ ok: true });
});

router.get("/me", authMiddleware, (req, res) => {
  const u = get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  if (!u) return res.status(401).json({ error: "用户不存在" });
  res.json({ user: publicUser(u) });
});

export default router;
