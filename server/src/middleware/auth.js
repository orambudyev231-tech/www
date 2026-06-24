import jwt from "jsonwebtoken";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { DATA_DIR } from "../db/index.js";

// JWT 密钥存 data/.jwt_secret（持久化，换重启不失效）
const SECRET_PATH = join(DATA_DIR, ".jwt_secret");
let SECRET;
if (existsSync(SECRET_PATH)) {
  SECRET = readFileSync(SECRET_PATH, "utf8").trim();
} else {
  SECRET = crypto.randomBytes(32).toString("hex");
  writeFileSync(SECRET_PATH, SECRET);
}

const EXPIRES = "7d";

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, { expiresIn: EXPIRES });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function readToken(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  return null;
}

// 必须登录
export function authMiddleware(req, res, next) {
  const payload = verifyToken(readToken(req));
  if (!payload) return res.status(401).json({ error: "未登录或登录已过期" });
  req.user = payload;
  next();
}

// 可选登录（不强制）
export function optionalAuth(req, res, next) {
  const payload = verifyToken(readToken(req));
  if (payload) req.user = payload;
  next();
}

// 仅管理员
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ error: "需要管理员权限" });
  next();
}
