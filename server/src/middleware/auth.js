import jwt from "jsonwebtoken";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { DATA_DIR, get } from "../db/index.js";

const SECRET_PATH = join(DATA_DIR, ".jwt_secret");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
let SECRET;
if (existsSync(SECRET_PATH)) {
  SECRET = readFileSync(SECRET_PATH, "utf8").trim();
} else {
  SECRET = crypto.randomBytes(32).toString("hex");
  writeFileSync(SECRET_PATH, SECRET);
}

const EXPIRES = "7d";

function readToken(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

async function freshUser(payload) {
  if (!payload?.id) return null;
  const user = await get("SELECT id, username, role, admin_level FROM users WHERE id = ?", [payload.id]);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    adminLevel: user.admin_level || ""
  };
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, adminLevel: user.admin_level || "" },
    SECRET,
    { expiresIn: EXPIRES }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

export async function authMiddleware(req, res, next) {
  const user = await freshUser(verifyToken(readToken(req)));
  if (!user) return res.status(401).json({ error: "unauthorized" });
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ error: "admin required" });
  next();
}

export function requireOwnerAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin" || req.user.adminLevel !== "owner") {
    return res.status(403).json({ error: "owner admin required" });
  }
  next();
}
