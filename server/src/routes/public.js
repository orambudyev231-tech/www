import { Router } from "express";
import multer from "multer";
import { join } from "path";
import crypto from "crypto";
import { all, get, run, DATA_DIR } from "../db/index.js";
import { create as createCaptcha, verify as verifyCaptcha } from "../captcha.js";
import { optionalAuth, authMiddleware } from "../middleware/auth.js";
import { getPublicData, serializeLink, serializeComment, getSettings } from "../serialize.js";
import { broadcast } from "../events.js";

const router = Router();
const PAGE = 20;

function clientIp(req) {
  return (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown").trim();
}

function today() {
  return new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD 本地
}

// 首页数据
router.get("/data", (req, res) => {
  res.json(getPublicData(req.query.group || ""));
});

router.get("/settings", (req, res) => res.json(getSettings()));

// 详情：浏览 +1
router.get("/link/:id", (req, res) => {
  const l = get("SELECT * FROM links WHERE id = ?", [req.params.id]);
  if (!l) return res.status(404).json({ error: "未找到" });
  run("UPDATE links SET views = views + 1 WHERE id = ?", [l.id]);
  const fresh = get("SELECT * FROM links WHERE id = ?", [l.id]);
  const cat = get("SELECT * FROM categories WHERE id = ?", [l.cat_id]);
  res.json({ link: serializeLink(fresh), category: cat ? { id: String(cat.id), name: cat.name } : null });
});

// 验证码
router.get("/captcha", (req, res) => {
  res.json(createCaptcha());
});

// 评论分页
router.get("/comments/:linkId", (req, res) => {
  const linkId = req.params.linkId;
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const limit = Math.min(50, Number(req.query.limit) || PAGE);
  const total = get("SELECT COUNT(*) AS c FROM comments WHERE link_id = ? AND visible = 1", [linkId]).c;
  const rows = all("SELECT * FROM comments WHERE link_id = ? AND visible = 1 ORDER BY id DESC LIMIT ? OFFSET ?", [linkId, limit, offset]);
  res.json({ total, comments: rows.map(serializeComment), hasMore: offset + rows.length < total });
});

// 发表评论：登录 + 验证码
router.post("/comment", authMiddleware, (req, res) => {
  const { linkId, content, image, captchaToken, captcha } = req.body || {};
  if (!verifyCaptcha(captchaToken, captcha)) return res.status(400).json({ error: "验证码不正确或已过期" });
  if (!content || !content.trim()) return res.status(400).json({ error: "评论内容不能为空" });
  if (!get("SELECT id FROM links WHERE id = ?", [linkId])) return res.status(400).json({ error: "链接不存在" });
  // 图片仅接受本站 /uploads 路径（防盗链/XSS）
  let img = "";
  if (image) {
    if (typeof image === "string" && image.startsWith("/uploads/")) img = image;
    else return res.status(400).json({ error: "图片只接受本站上传地址" });
  }
  const u = get("SELECT * FROM users WHERE id = ?", [req.user.id]);
  run("INSERT INTO comments (link_id, user_id, nickname, role, content, image_url) VALUES (?,?,?,?,?,?)", [
    linkId,
    u.id,
    u.nickname || u.username,
    u.role === "admin" ? "管理员" : "",
    content.trim(),
    img
  ]);
  broadcast();
  const c = get("SELECT * FROM comments WHERE id = last_insert_rowid()");
  res.json({ comment: serializeComment(c) });
});

// 评论图片上传（限本站 /uploads，≤5MB）
const upload = multer({
  storage: multer.diskStorage({
    destination: join(DATA_DIR, "uploads"),
    filename: (req, file, cb) => {
      const ext = (file.originalname.match(/\.[a-z0-9]+$/i) || [".png"])[0].toLowerCase();
      cb(null, crypto.randomBytes(8).toString("hex") + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

router.post("/comment-image", authMiddleware, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "请上传图片文件（≤5MB）" });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// 访客埋点
router.post("/visit", (req, res) => {
  const d = today();
  const ip = clientIp(req);
  run("INSERT INTO stats_daily (date, pv, uv) VALUES (?,1,0) ON CONFLICT(date) DO UPDATE SET pv = pv + 1", [d]);
  const exists = get("SELECT 1 AS x FROM visit_ips WHERE date = ? AND ip = ?", [d, ip]);
  if (!exists) {
    run("INSERT INTO visit_ips (date, ip) VALUES (?,?)", [d, ip]);
    run("UPDATE stats_daily SET uv = uv + 1 WHERE date = ?", [d]);
  }
  res.json({ ok: true });
});

// 投稿（登录用户）
router.post("/submission", authMiddleware, (req, res) => {
  const { title, url, desc, cat } = req.body || {};
  if (!title || !url) return res.status(400).json({ error: "请填写名称和链接" });
  run("INSERT INTO submissions (user_id, title, url, descr, cat_id, status) VALUES (?,?,?,?,?, '待审核')", [
    req.user.id,
    title,
    url,
    desc || "",
    cat || null
  ]);
  res.json({ ok: true });
});

export default router;
