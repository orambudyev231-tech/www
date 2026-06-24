import { Router } from "express";
import multer from "multer";
import { join } from "path";
import crypto from "crypto";
import { existsSync, unlinkSync, readdirSync } from "fs";
import { all, get, run, DATA_DIR } from "../db/index.js";
import { authMiddleware, requireAdmin } from "../middleware/auth.js";
import { serializeLink, serializeAd, serializeCategory, getSettings } from "../serialize.js";
import { fetchIcon } from "../favicon.js";
import { broadcast } from "../events.js";

const router = Router();
router.use(authMiddleware, requireAdmin);

function getDomain(url) {
  return (url || "").replace(/^https?:\/\//, "").split("/")[0] || "";
}
const after = (res, extra = {}) => {
  broadcast();
  res.json({ ok: true, ...extra });
};

/* ---------- 链接 ---------- */
router.get("/links", (req, res) => res.json(all("SELECT * FROM links ORDER BY sort, id").map(serializeLink)));
router.post("/links", (req, res) => {
  const { title, url, cat, sub, desc, badge } = req.body || {};
  if (!title || !url) return res.status(400).json({ error: "缺少标题或链接" });
  // 新增链接排到最前面：sort 取比现有最小值再小 1
  const sort = get("SELECT COALESCE(MIN(sort),0)-1 AS s FROM links").s;
  run("INSERT INTO links (cat_id, sub, title, url, domain, descr, badge, sort) VALUES (?,?,?,?,?,?,?,?)", [
    cat || null, sub || "", title, url, getDomain(url), desc || "", badge || "", sort
  ]);
  after(res, { id: get("SELECT last_insert_rowid() AS id").id });
});
router.put("/links/:id", (req, res) => {
  const f = req.body || {};
  const cur = get("SELECT * FROM links WHERE id = ?", [req.params.id]);
  if (!cur) return res.status(404).json({ error: "未找到" });
  run("UPDATE links SET cat_id=?, sub=?, title=?, url=?, domain=?, descr=?, badge=?, visible=? WHERE id=?", [
    f.cat ?? cur.cat_id, f.sub ?? cur.sub, f.title ?? cur.title, f.url ?? cur.url,
    getDomain(f.url ?? cur.url), f.desc ?? cur.descr, f.badge ?? cur.badge,
    f.visible === undefined ? cur.visible : f.visible ? 1 : 0, req.params.id
  ]);
  after(res);
});
router.delete("/links/:id", (req, res) => {
  // 级联删除评论与图片文件
  const imgs = all("SELECT image_url FROM comments WHERE link_id = ?", [req.params.id]);
  imgs.forEach((c) => {
    if (c.image_url && c.image_url.startsWith("/uploads/")) {
      const p = join(DATA_DIR, c.image_url.replace("/uploads/", "uploads/"));
      if (existsSync(p)) try { unlinkSync(p); } catch {}
    }
  });
  run("DELETE FROM comments WHERE link_id = ?", [req.params.id]);
  run("DELETE FROM sub_links WHERE link_id = ?", [req.params.id]);
  run("DELETE FROM links WHERE id = ?", [req.params.id]);
  after(res);
});
router.put("/links/:id/desc-gradient", (req, res) => {
  run("UPDATE links SET desc_gradient = ? WHERE id = ?", [JSON.stringify(req.body.gradient || []), req.params.id]);
  after(res);
});
// 单条链接颜色（标题/描述/角标）
router.put("/links/:id/colors", (req, res) => {
  const cur = get("SELECT * FROM links WHERE id = ?", [req.params.id]);
  if (!cur) return res.status(404).json({ error: "未找到" });
  run("UPDATE links SET title_color=?, desc_color=?, badge_color=? WHERE id=?", [
    req.body.titleColor ?? cur.title_color, req.body.descColor ?? cur.desc_color, req.body.badgeColor ?? cur.badge_color, req.params.id
  ]);
  after(res);
});
router.post("/links/:id/sub", (req, res) => {
  run("INSERT INTO sub_links (link_id, title, url) VALUES (?,?,?)", [req.params.id, req.body.title, req.body.url]);
  after(res);
});
router.delete("/links/:id/sub/:subId", (req, res) => {
  run("DELETE FROM sub_links WHERE id = ?", [req.params.subId]);
  after(res);
});
// 一次性替换某链接的全部子链接
router.put("/links/:id/subs", (req, res) => {
  const subs = Array.isArray(req.body.subs) ? req.body.subs : [];
  run("DELETE FROM sub_links WHERE link_id = ?", [req.params.id]);
  subs.forEach((s) => {
    if (s && s.title && s.url) run("INSERT INTO sub_links (link_id, title, url) VALUES (?,?,?)", [req.params.id, s.title, s.url]);
  });
  after(res);
});

/* ---------- 分类 / 子分类 ---------- */
router.get("/categories", (req, res) => res.json(all("SELECT * FROM categories ORDER BY sort, id").map(serializeCategory)));
router.post("/categories", (req, res) => {
  run("INSERT INTO categories (name, page_group, sort) VALUES (?,?,?)", [
    req.body.name || "新分类", req.body.group || "home",
    get("SELECT COALESCE(MAX(sort),0)+1 AS s FROM categories").s
  ]);
  after(res);
});
router.put("/categories/:id", (req, res) => {
  const c = get("SELECT * FROM categories WHERE id = ?", [req.params.id]);
  if (!c) return res.status(404).json({ error: "未找到" });
  run("UPDATE categories SET name=?, page_group=?, visible=? WHERE id=?", [
    req.body.name ?? c.name, req.body.group ?? c.page_group,
    req.body.visible === undefined ? c.visible : req.body.visible ? 1 : 0, req.params.id
  ]);
  after(res);
});
router.delete("/categories/:id", (req, res) => {
  run("DELETE FROM sub_categories WHERE cat_id = ?", [req.params.id]);
  run("DELETE FROM categories WHERE id = ?", [req.params.id]);
  after(res);
});
router.post("/sub-categories", (req, res) => {
  run("INSERT INTO sub_categories (cat_id, name, sort) VALUES (?,?,?)", [
    req.body.cat, req.body.name, get("SELECT COALESCE(MAX(sort),0)+1 AS s FROM sub_categories").s
  ]);
  after(res);
});
router.delete("/sub-categories/:id", (req, res) => {
  run("DELETE FROM sub_categories WHERE id = ?", [req.params.id]);
  after(res);
});

/* ---------- 导航 / 页面 ---------- */
router.get("/navs", (req, res) => res.json(all("SELECT * FROM navs ORDER BY sort, id").map((n) => ({ ...n, id: String(n.id), visible: n.visible !== 0 }))));
router.post("/navs", (req, res) => {
  run("INSERT INTO navs (name, url, sort) VALUES (?,?,?)", [req.body.name || "新导航", req.body.url || "#", get("SELECT COALESCE(MAX(sort),0)+1 AS s FROM navs").s]);
  after(res);
});
router.put("/navs/:id", (req, res) => {
  const n = get("SELECT * FROM navs WHERE id = ?", [req.params.id]);
  run("UPDATE navs SET name=?, url=?, visible=? WHERE id=?", [req.body.name ?? n.name, req.body.url ?? n.url, req.body.visible === undefined ? n.visible : req.body.visible ? 1 : 0, req.params.id]);
  after(res);
});
router.delete("/navs/:id", (req, res) => { run("DELETE FROM navs WHERE id = ?", [req.params.id]); after(res); });

router.get("/pages", (req, res) => res.json(all("SELECT * FROM pages ORDER BY id").map((p) => ({ ...p, id: String(p.id), visible: p.visible !== 0 }))));
router.post("/pages", (req, res) => { run("INSERT INTO pages (name, content) VALUES (?,?)", [req.body.name || "新页面", req.body.content || ""]); after(res); });
router.put("/pages/:id", (req, res) => {
  const p = get("SELECT * FROM pages WHERE id = ?", [req.params.id]);
  run("UPDATE pages SET name=?, content=?, visible=? WHERE id=?", [req.body.name ?? p.name, req.body.content ?? p.content, req.body.visible === undefined ? p.visible : req.body.visible ? 1 : 0, req.params.id]);
  after(res);
});
router.delete("/pages/:id", (req, res) => { run("DELETE FROM pages WHERE id = ?", [req.params.id]); after(res); });

/* ---------- 广告 ---------- */
router.get("/ads", (req, res) => res.json(all("SELECT * FROM ads ORDER BY position, id").map(serializeAd)));
router.post("/ads", (req, res) => {
  const { title, url, desc, badge } = req.body || {};
  if (!title || !url) return res.status(400).json({ error: "缺少标题或链接" });
  run("INSERT INTO ads (title, descr, url, domain, badge, position) VALUES (?,?,?,?,?,?)", [
    title, desc || "", url, getDomain(url), badge || "AD", get("SELECT COALESCE(MAX(position),0)+1 AS s FROM ads").s
  ]);
  after(res);
});
router.put("/ads/:id", (req, res) => {
  const a = get("SELECT * FROM ads WHERE id = ?", [req.params.id]);
  if (!a) return res.status(404).json({ error: "未找到" });
  run("UPDATE ads SET title=?, descr=?, url=?, domain=?, badge=?, visible=? WHERE id=?", [
    req.body.title ?? a.title, req.body.desc ?? a.descr, req.body.url ?? a.url,
    getDomain(req.body.url ?? a.url), req.body.badge ?? a.badge,
    req.body.visible === undefined ? a.visible : req.body.visible ? 1 : 0, req.params.id
  ]);
  after(res);
});
router.delete("/ads/:id", (req, res) => {
  run("DELETE FROM ad_sub_links WHERE ad_id = ?", [req.params.id]);
  run("DELETE FROM ads WHERE id = ?", [req.params.id]);
  after(res);
});
router.put("/ads/:id/desc-gradient", (req, res) => {
  run("UPDATE ads SET desc_gradient = ? WHERE id = ?", [JSON.stringify(req.body.gradient || []), req.params.id]);
  after(res);
});
// 单条广告颜色（标题/描述/角标）
router.put("/ads/:id/colors", (req, res) => {
  const cur = get("SELECT * FROM ads WHERE id = ?", [req.params.id]);
  if (!cur) return res.status(404).json({ error: "未找到" });
  run("UPDATE ads SET title_color=?, desc_color=?, badge_color=? WHERE id=?", [
    req.body.titleColor ?? cur.title_color, req.body.descColor ?? cur.desc_color, req.body.badgeColor ?? cur.badge_color, req.params.id
  ]);
  after(res);
});
router.post("/ads/:id/sub", (req, res) => {
  run("INSERT INTO ad_sub_links (ad_id, title, url) VALUES (?,?,?)", [req.params.id, req.body.title, req.body.url]);
  after(res);
});

/* ---------- 跑马灯 / 横幅 ---------- */
router.get("/notices", (req, res) => res.json(all("SELECT * FROM notices ORDER BY sort, id").map((n) => ({ ...n, id: String(n.id), visible: n.visible !== 0 }))));
router.post("/notices", (req, res) => { run("INSERT INTO notices (text, sort) VALUES (?,?)", [req.body.text || "", get("SELECT COALESCE(MAX(sort),0)+1 AS s FROM notices").s]); after(res); });
router.put("/notices/:id", (req, res) => {
  const n = get("SELECT * FROM notices WHERE id = ?", [req.params.id]);
  run("UPDATE notices SET text=?, visible=? WHERE id=?", [req.body.text ?? n.text, req.body.visible === undefined ? n.visible : req.body.visible ? 1 : 0, req.params.id]);
  after(res);
});
router.delete("/notices/:id", (req, res) => { run("DELETE FROM notices WHERE id = ?", [req.params.id]); after(res); });

router.get("/banners", (req, res) => res.json(all("SELECT * FROM banners ORDER BY sort, id").map((b) => ({ ...b, id: String(b.id), visible: b.visible !== 0 }))));
router.post("/banners", (req, res) => { run("INSERT INTO banners (url, sort) VALUES (?,?)", [req.body.url || "", get("SELECT COALESCE(MAX(sort),0)+1 AS s FROM banners").s]); after(res); });
router.delete("/banners/:id", (req, res) => { run("DELETE FROM banners WHERE id = ?", [req.params.id]); after(res); });

/* ---------- 图标 ---------- */
const iconUpload = multer({
  storage: multer.diskStorage({
    destination: join(DATA_DIR, "icons"),
    filename: (req, file, cb) => {
      const ext = (file.originalname.match(/\.[a-z0-9]+$/i) || [".png"])[0].toLowerCase();
      cb(null, "up_" + crypto.randomBytes(6).toString("hex") + ext); // 手动上传前缀 up_
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 }
});
router.post("/upload-icon", iconUpload.single("icon"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "请上传图标" });
  const url = `/icons/${req.file.filename}`;
  if (req.body.linkId) run("UPDATE links SET icon = ? WHERE id = ?", [url, req.body.linkId]);
  if (req.body.adId) run("UPDATE ads SET icon = ? WHERE id = ?", [url, req.body.adId]);
  after(res, { url });
});
router.post("/fetch-icon", async (req, res) => {
  const domain = getDomain(req.body.url) || req.body.domain;
  const icon = await fetchIcon(domain);
  if (req.body.linkId) run("UPDATE links SET icon = ? WHERE id = ?", [icon, req.body.linkId]);
  if (req.body.adId) run("UPDATE ads SET icon = ? WHERE id = ?", [icon, req.body.adId]);
  after(res, { url: icon });
});
// 批量重抓：跳过手动上传(up_)的，不覆盖
router.post("/refetch-icons", async (req, res) => {
  const links = all("SELECT * FROM links");
  let count = 0;
  for (const l of links) {
    if (l.icon && /\/icons\/up_/.test(l.icon)) continue; // 跳过手动上传
    const icon = await fetchIcon(l.domain || getDomain(l.url));
    run("UPDATE links SET icon = ? WHERE id = ?", [icon, l.id]);
    count++;
  }
  after(res, { count });
});

/* ---------- 设置 / 颜色 ---------- */
router.get("/settings", (req, res) => res.json(getSettings()));
router.put("/settings", (req, res) => {
  const body = req.body || {};
  Object.entries(body).forEach(([k, v]) => {
    const val = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
    run("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = ?", [k, val, val]);
  });
  after(res);
});

/* ---------- 用户 / 评论 / 投稿 ---------- */
router.get("/users", (req, res) =>
  res.json(all("SELECT id, username, role, nickname, nickname_color, role_color, created_at FROM users ORDER BY id").map((u) => ({ ...u, id: String(u.id) })))
);
router.put("/users/:id", (req, res) => {
  const u = get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!u) return res.status(404).json({ error: "未找到" });
  run("UPDATE users SET nickname=?, nickname_color=?, role_color=? WHERE id=?", [
    req.body.nickname ?? u.nickname, req.body.nickname_color ?? u.nickname_color, req.body.role_color ?? u.role_color, req.params.id
  ]);
  after(res);
});
router.delete("/users/:id", (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "不能删除自己" });
  run("DELETE FROM users WHERE id = ?", [req.params.id]);
  after(res);
});

router.get("/comments", (req, res) => {
  const rows = all(`SELECT c.*, l.title AS link_title FROM comments c LEFT JOIN links l ON l.id = c.link_id ORDER BY c.id DESC`);
  res.json(rows.map((c) => ({ id: String(c.id), linkId: String(c.link_id), linkTitle: c.link_title || c.link_id, user: c.nickname, content: c.content, image: c.image_url, time: c.created_at })));
});
router.delete("/comments/:id", (req, res) => {
  const c = get("SELECT * FROM comments WHERE id = ?", [req.params.id]);
  if (c && c.image_url && c.image_url.startsWith("/uploads/")) {
    const p = join(DATA_DIR, c.image_url.replace("/uploads/", "uploads/"));
    if (existsSync(p)) try { unlinkSync(p); } catch {}
  }
  run("DELETE FROM comments WHERE id = ?", [req.params.id]);
  after(res);
});

router.get("/submissions", (req, res) =>
  res.json(all("SELECT * FROM submissions ORDER BY id DESC").map((s) => ({ id: String(s.id), title: s.title, url: s.url, desc: s.descr, cat: s.cat_id ? String(s.cat_id) : "", status: s.status, time: s.created_at })))
);
router.post("/submissions/:id/approve", (req, res) => {
  const s = get("SELECT * FROM submissions WHERE id = ?", [req.params.id]);
  if (!s) return res.status(404).json({ error: "未找到" });
  const catId = s.cat_id || get("SELECT id FROM categories ORDER BY sort, id LIMIT 1")?.id;
  const sort = get("SELECT COALESCE(MIN(sort),0)-1 AS s FROM links").s;
  run("INSERT INTO links (cat_id, sub, title, url, domain, descr, badge, sort) VALUES (?,?,?,?,?,?,?,?)", [
    catId, "投稿", s.title, s.url, getDomain(s.url), s.descr, "投", sort
  ]);
  run("UPDATE submissions SET status = '已通过' WHERE id = ?", [s.id]);
  after(res);
});
router.post("/submissions/:id/reject", (req, res) => { run("UPDATE submissions SET status = '已拒绝' WHERE id = ?", [req.params.id]); after(res); });
router.delete("/submissions/:id", (req, res) => { run("DELETE FROM submissions WHERE id = ?", [req.params.id]); after(res); });

/* ---------- 统计 ---------- */
router.get("/stats", (req, res) => {
  const d = new Date().toLocaleDateString("sv-SE");
  const todayRow = get("SELECT pv, uv FROM stats_daily WHERE date = ?", [d]) || { pv: 0, uv: 0 };
  const totalPv = get("SELECT COALESCE(SUM(pv),0) AS s FROM stats_daily").s;
  const totalUv = get("SELECT COALESCE(SUM(uv),0) AS s FROM stats_daily").s;
  const linkViews = get("SELECT COALESCE(SUM(views),0) AS s FROM links").s;
  const comments = get("SELECT COUNT(*) AS c FROM comments").c;
  const submissions = get("SELECT COUNT(*) AS c FROM submissions").c;
  // 近 14 天序列
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toLocaleDateString("sv-SE");
    const row = get("SELECT pv, uv FROM stats_daily WHERE date = ?", [day]) || { pv: 0, uv: 0 };
    series.push({ date: day.slice(5), pv: row.pv, uv: row.uv });
  }
  res.json({ todayPv: todayRow.pv, todayUv: todayRow.uv, totalPv, totalUv, linkViews, comments, submissions, series });
});

export default router;
