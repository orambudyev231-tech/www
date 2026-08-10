import { Router } from "express";
import multer from "multer";
import { join } from "path";
import crypto from "crypto";
import { existsSync, unlinkSync } from "fs";
import { all, get, run, DATA_DIR } from "../db/index.js";
import { authMiddleware, requireAdmin } from "../middleware/auth.js";
import { serializeLink, serializeAd, serializeCategory, getSettings } from "../serialize.js";
import { fetchIcon } from "../favicon.js";
import { broadcast } from "../events.js";
import { wrapAsyncRoutes } from "./async.js";

const router = wrapAsyncRoutes(Router());
router.use((req, res, next) => Promise.resolve(authMiddleware(req, res, next)).catch(next), requireAdmin);

router.use((req, res, next) => {
  if (req.user.adminLevel === "owner" || req.method === "GET") return next();
  const blockedPost = [
    /^\/refetch-icons$/,
    /^\/submissions\/[^/]+\/approve$/,
    /^\/submissions\/[^/]+\/reject$/
  ].some((rule) => rule.test(req.path));
  if (req.method === "POST" && !blockedPost) return next();
  return res.status(403).json({ error: "limited admin can only add content" });
});

function getDomain(url) {
  return (url || "").replace(/^https?:\/\//, "").split("/")[0] || "";
}
const after = (res, extra = {}) => {
  broadcast();
  res.json({ ok: true, ...extra });
};

function browserName(ua = "") {
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  if (/MicroMessenger/i.test(ua)) return "微信";
  return ua ? "其他" : "未知";
}

router.get("/links", async (req, res) => res.json(await Promise.all((await all("SELECT * FROM links ORDER BY sort, id")).map(serializeLink))));
router.post("/links", async (req, res) => {
  const { title, url, cat, sub, desc, badge } = req.body || {};
  if (!title || !url) return res.status(400).json({ error: "缺少标题或链接" });
  const sort = (await get("SELECT COALESCE(MIN(sort),0)-1 AS s FROM links")).s;
  const result = await run("INSERT INTO links (cat_id, sub, title, url, domain, descr, badge, sort) VALUES (?,?,?,?,?,?,?,?)", [
    cat || null, sub || "", title, url, getDomain(url), desc || "", badge || "", sort
  ]);
  after(res, { id: result.insertId });
});
router.put("/links/:id", async (req, res) => {
  const f = req.body || {};
  const cur = await get("SELECT * FROM links WHERE id = ?", [req.params.id]);
  if (!cur) return res.status(404).json({ error: "未找到" });
  await run("UPDATE links SET cat_id=?, sub=?, title=?, url=?, domain=?, descr=?, badge=?, visible=? WHERE id=?", [
    f.cat ?? cur.cat_id, f.sub ?? cur.sub, f.title ?? cur.title, f.url ?? cur.url,
    getDomain(f.url ?? cur.url), f.desc ?? cur.descr, f.badge ?? cur.badge,
    f.visible === undefined ? cur.visible : f.visible ? 1 : 0, req.params.id
  ]);
  after(res);
});
router.delete("/links/:id", async (req, res) => {
  const imgs = await all("SELECT image_url FROM comments WHERE link_id = ?", [req.params.id]);
  imgs.forEach((c) => {
    if (c.image_url && c.image_url.startsWith("/uploads/")) {
      const p = join(DATA_DIR, c.image_url.replace("/uploads/", "uploads/"));
      if (existsSync(p)) try { unlinkSync(p); } catch {}
    }
  });
  await run("DELETE FROM comments WHERE link_id = ?", [req.params.id]);
  await run("DELETE FROM sub_links WHERE link_id = ?", [req.params.id]);
  await run("DELETE FROM links WHERE id = ?", [req.params.id]);
  after(res);
});
router.put("/links/:id/desc-gradient", async (req, res) => {
  await run("UPDATE links SET desc_gradient = ? WHERE id = ?", [JSON.stringify(req.body.gradient || []), req.params.id]);
  after(res);
});
router.put("/links/:id/colors", async (req, res) => {
  const cur = await get("SELECT * FROM links WHERE id = ?", [req.params.id]);
  if (!cur) return res.status(404).json({ error: "未找到" });
  await run("UPDATE links SET title_color=?, desc_color=?, badge_color=? WHERE id=?", [
    req.body.titleColor ?? cur.title_color, req.body.descColor ?? cur.desc_color, req.body.badgeColor ?? cur.badge_color, req.params.id
  ]);
  after(res);
});
router.post("/links/:id/sub", async (req, res) => {
  await run("INSERT INTO sub_links (link_id, title, url) VALUES (?,?,?)", [req.params.id, req.body.title, req.body.url]);
  after(res);
});
router.delete("/links/:id/sub/:subId", async (req, res) => {
  await run("DELETE FROM sub_links WHERE id = ?", [req.params.subId]);
  after(res);
});
router.put("/links/:id/subs", async (req, res) => {
  const subs = Array.isArray(req.body.subs) ? req.body.subs : [];
  await run("DELETE FROM sub_links WHERE link_id = ?", [req.params.id]);
  for (const s of subs) {
    if (s && s.title && s.url) await run("INSERT INTO sub_links (link_id, title, url) VALUES (?,?,?)", [req.params.id, s.title, s.url]);
  }
  after(res);
});

router.get("/categories", async (req, res) => res.json(await Promise.all((await all("SELECT * FROM categories ORDER BY sort, id")).map(serializeCategory))));
router.post("/categories", async (req, res) => {
  await run("INSERT INTO categories (name, page_group, sort) VALUES (?,?,?)", [
    req.body.name || "新分类", req.body.group || "home",
    (await get("SELECT COALESCE(MAX(sort),0)+1 AS s FROM categories")).s
  ]);
  after(res);
});
router.put("/categories/:id", async (req, res) => {
  const c = await get("SELECT * FROM categories WHERE id = ?", [req.params.id]);
  if (!c) return res.status(404).json({ error: "未找到" });
  await run("UPDATE categories SET name=?, page_group=?, visible=? WHERE id=?", [
    req.body.name ?? c.name, req.body.group ?? c.page_group,
    req.body.visible === undefined ? c.visible : req.body.visible ? 1 : 0, req.params.id
  ]);
  after(res);
});
router.post("/categories/:id/move", async (req, res) => {
  const dir = req.body?.dir === "up" ? "up" : "down";
  const cats = await all("SELECT id FROM categories ORDER BY sort, id");
  const idx = cats.findIndex((c) => String(c.id) === String(req.params.id));
  if (idx < 0) return res.status(404).json({ error: "未找到" });
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= cats.length) return after(res);
  // 按当前顺序整体重编号后交换，避免历史 sort 值重复导致交换无效
  [cats[idx], cats[swap]] = [cats[swap], cats[idx]];
  for (let i = 0; i < cats.length; i++) await run("UPDATE categories SET sort=? WHERE id=?", [i, cats[i].id]);
  after(res);
});
router.delete("/categories/:id", async (req, res) => {
  await run("DELETE FROM sub_categories WHERE cat_id = ?", [req.params.id]);
  await run("DELETE FROM categories WHERE id = ?", [req.params.id]);
  after(res);
});
router.post("/sub-categories", async (req, res) => {
  await run("INSERT INTO sub_categories (cat_id, name, sort) VALUES (?,?,?)", [
    req.body.cat, req.body.name, (await get("SELECT COALESCE(MAX(sort),0)+1 AS s FROM sub_categories")).s
  ]);
  after(res);
});
router.put("/sub-categories/:id", async (req, res) => {
  const cur = await get("SELECT * FROM sub_categories WHERE id = ?", [req.params.id]);
  if (!cur) return res.status(404).json({ error: "未找到" });
  await run("UPDATE sub_categories SET cat_id=?, name=? WHERE id=?", [
    req.body.cat ?? cur.cat_id, req.body.name ?? cur.name, req.params.id
  ]);
  after(res);
});
router.delete("/sub-categories/:id", async (req, res) => {
  await run("DELETE FROM sub_categories WHERE id = ?", [req.params.id]);
  after(res);
});

router.get("/navs", async (req, res) => res.json((await all("SELECT * FROM navs ORDER BY sort, id")).map((n) => ({ ...n, id: String(n.id), visible: n.visible !== 0 }))));
router.post("/navs", async (req, res) => {
  await run("INSERT INTO navs (name, url, sort) VALUES (?,?,?)", [req.body.name || "新导航", req.body.url || "#", (await get("SELECT COALESCE(MAX(sort),0)+1 AS s FROM navs")).s]);
  after(res);
});
router.put("/navs/:id", async (req, res) => {
  const n = await get("SELECT * FROM navs WHERE id = ?", [req.params.id]);
  await run("UPDATE navs SET name=?, url=?, visible=? WHERE id=?", [req.body.name ?? n.name, req.body.url ?? n.url, req.body.visible === undefined ? n.visible : req.body.visible ? 1 : 0, req.params.id]);
  after(res);
});
router.delete("/navs/:id", async (req, res) => { await run("DELETE FROM navs WHERE id = ?", [req.params.id]); after(res); });

router.get("/pages", async (req, res) => res.json((await all("SELECT * FROM pages ORDER BY id")).map((p) => ({ ...p, id: String(p.id), visible: p.visible !== 0 }))));
router.post("/pages", async (req, res) => { await run("INSERT INTO pages (name, content) VALUES (?,?)", [req.body.name || "新页面", req.body.content || ""]); after(res); });
router.put("/pages/:id", async (req, res) => {
  const p = await get("SELECT * FROM pages WHERE id = ?", [req.params.id]);
  await run("UPDATE pages SET name=?, content=?, visible=? WHERE id=?", [req.body.name ?? p.name, req.body.content ?? p.content, req.body.visible === undefined ? p.visible : req.body.visible ? 1 : 0, req.params.id]);
  after(res);
});
router.delete("/pages/:id", async (req, res) => { await run("DELETE FROM pages WHERE id = ?", [req.params.id]); after(res); });

router.get("/ads", async (req, res) => res.json(await Promise.all((await all("SELECT * FROM ads ORDER BY position, id")).map(serializeAd))));
router.post("/ads", async (req, res) => {
  const { title, url, desc, badge } = req.body || {};
  if (!title || !url) return res.status(400).json({ error: "缺少标题或链接" });
  const result = await run("INSERT INTO ads (title, descr, url, domain, badge, position) VALUES (?,?,?,?,?,?)", [
    title, desc || "", url, getDomain(url), badge || "AD", (await get("SELECT COALESCE(MAX(position),0)+1 AS s FROM ads")).s
  ]);
  const id = result.insertId;
  const subs = Array.isArray(req.body.subs) ? req.body.subs : [];
  for (const s of subs) {
    if (s && s.title && s.url) await run("INSERT INTO ad_sub_links (ad_id, title, url) VALUES (?,?,?)", [id, s.title, s.url]);
  }
  after(res, { id });
});
router.put("/ads/:id", async (req, res) => {
  const a = await get("SELECT * FROM ads WHERE id = ?", [req.params.id]);
  if (!a) return res.status(404).json({ error: "未找到" });
  await run("UPDATE ads SET title=?, descr=?, url=?, domain=?, badge=?, visible=? WHERE id=?", [
    req.body.title ?? a.title, req.body.desc ?? a.descr, req.body.url ?? a.url,
    getDomain(req.body.url ?? a.url), req.body.badge ?? a.badge,
    req.body.visible === undefined ? a.visible : req.body.visible ? 1 : 0, req.params.id
  ]);
  after(res);
});
router.delete("/ads/:id", async (req, res) => {
  await run("DELETE FROM ad_sub_links WHERE ad_id = ?", [req.params.id]);
  await run("DELETE FROM ads WHERE id = ?", [req.params.id]);
  after(res);
});
router.put("/ads/:id/desc-gradient", async (req, res) => {
  await run("UPDATE ads SET desc_gradient = ? WHERE id = ?", [JSON.stringify(req.body.gradient || []), req.params.id]);
  after(res);
});
router.put("/ads/:id/colors", async (req, res) => {
  const cur = await get("SELECT * FROM ads WHERE id = ?", [req.params.id]);
  if (!cur) return res.status(404).json({ error: "未找到" });
  await run("UPDATE ads SET title_color=?, desc_color=?, badge_color=? WHERE id=?", [
    req.body.titleColor ?? cur.title_color, req.body.descColor ?? cur.desc_color, req.body.badgeColor ?? cur.badge_color, req.params.id
  ]);
  after(res);
});
router.post("/ads/:id/sub", async (req, res) => {
  await run("INSERT INTO ad_sub_links (ad_id, title, url) VALUES (?,?,?)", [req.params.id, req.body.title, req.body.url]);
  after(res);
});
router.put("/ads/:id/subs", async (req, res) => {
  const subs = Array.isArray(req.body.subs) ? req.body.subs : [];
  await run("DELETE FROM ad_sub_links WHERE ad_id = ?", [req.params.id]);
  for (const s of subs) {
    if (s && s.title && s.url) await run("INSERT INTO ad_sub_links (ad_id, title, url) VALUES (?,?,?)", [req.params.id, s.title, s.url]);
  }
  after(res);
});

router.get("/notices", async (req, res) => res.json((await all("SELECT * FROM notices ORDER BY sort, id")).map((n) => ({ ...n, id: String(n.id), url: n.url || "", color: n.color || "#334155", visible: n.visible !== 0 }))));
router.post("/notices", async (req, res) => {
  await run("INSERT INTO notices (text, url, color, sort) VALUES (?,?,?,?)", [
    req.body.text || "",
    req.body.url || "",
    req.body.color || "#334155",
    (await get("SELECT COALESCE(MAX(sort),0)+1 AS s FROM notices")).s
  ]);
  after(res);
});
router.put("/notices/:id", async (req, res) => {
  const n = await get("SELECT * FROM notices WHERE id = ?", [req.params.id]);
  await run("UPDATE notices SET text=?, url=?, color=?, visible=? WHERE id=?", [
    req.body.text ?? n.text,
    req.body.url ?? n.url,
    req.body.color ?? n.color,
    req.body.visible === undefined ? n.visible : req.body.visible ? 1 : 0,
    req.params.id
  ]);
  after(res);
});
router.delete("/notices/:id", async (req, res) => { await run("DELETE FROM notices WHERE id = ?", [req.params.id]); after(res); });

router.get("/banners", async (req, res) => res.json((await all("SELECT * FROM banners ORDER BY sort, id")).map((b) => ({ ...b, id: String(b.id), visible: b.visible !== 0 }))));
router.post("/banners", async (req, res) => {
  const url = String(req.body.url || "").trim();
  if (!url) return res.status(400).json({ error: "请填写图片 URL" });
  await run("INSERT INTO banners (url, sort) VALUES (?,?)", [url, (await get("SELECT COALESCE(MAX(sort),0)+1 AS s FROM banners")).s]);
  after(res);
});
router.put("/banners/:id", async (req, res) => {
  const b = await get("SELECT * FROM banners WHERE id = ?", [req.params.id]);
  if (!b) return res.status(404).json({ error: "not found" });
  await run("UPDATE banners SET visible=? WHERE id=?", [req.body.visible === undefined ? b.visible : req.body.visible ? 1 : 0, req.params.id]);
  after(res);
});
const bannerUpload = multer({
  storage: multer.diskStorage({
    destination: join(DATA_DIR, "uploads"),
    filename: (req, file, cb) => {
      const ext = (file.originalname.match(/\.[a-z0-9]+$/i) || [".png"])[0].toLowerCase();
      cb(null, "banner_" + crypto.randomBytes(8).toString("hex") + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }
});
router.post("/upload-banner", bannerUpload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "请上传图片文件" });
  const url = `/uploads/${req.file.filename}`;
  await run("INSERT INTO banners (url, sort) VALUES (?,?)", [url, (await get("SELECT COALESCE(MAX(sort),0)+1 AS s FROM banners")).s]);
  after(res, { url });
});
router.delete("/banners/:id", async (req, res) => {
  const b = await get("SELECT * FROM banners WHERE id = ?", [req.params.id]);
  if (b?.url && b.url.startsWith("/uploads/")) {
    const p = join(DATA_DIR, b.url.replace("/uploads/", "uploads/"));
    if (existsSync(p)) try { unlinkSync(p); } catch {}
  }
  await run("DELETE FROM banners WHERE id = ?", [req.params.id]);
  after(res);
});

const iconUpload = multer({
  storage: multer.diskStorage({
    destination: join(DATA_DIR, "icons"),
    filename: (req, file, cb) => {
      const ext = (file.originalname.match(/\.[a-z0-9]+$/i) || [".png"])[0].toLowerCase();
      cb(null, "up_" + crypto.randomBytes(6).toString("hex") + ext);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 }
});
router.post("/upload-icon", iconUpload.single("icon"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "请上传图标" });
  const url = `/icons/${req.file.filename}`;
  if (req.body.linkId) await run("UPDATE links SET icon = ? WHERE id = ?", [url, req.body.linkId]);
  if (req.body.adId) await run("UPDATE ads SET icon = ? WHERE id = ?", [url, req.body.adId]);
  after(res, { url });
});
router.post("/fetch-icon", async (req, res) => {
  const domain = getDomain(req.body.url) || req.body.domain;
  const icon = await fetchIcon(domain);
  if (req.body.linkId) await run("UPDATE links SET icon = ? WHERE id = ?", [icon, req.body.linkId]);
  if (req.body.adId) await run("UPDATE ads SET icon = ? WHERE id = ?", [icon, req.body.adId]);
  after(res, { url: icon });
});
router.post("/refetch-icons", async (req, res) => {
  const links = await all("SELECT * FROM links");
  const ads = await all("SELECT * FROM ads");
  let count = 0;
  for (const l of links) {
    if (l.icon && /\/icons\/up_/.test(l.icon)) continue;
    const icon = await fetchIcon(l.domain || getDomain(l.url));
    await run("UPDATE links SET icon = ? WHERE id = ?", [icon, l.id]);
    count++;
  }
  for (const a of ads) {
    if (a.icon && /\/icons\/up_/.test(a.icon)) continue;
    const icon = await fetchIcon(a.domain || getDomain(a.url));
    await run("UPDATE ads SET icon = ? WHERE id = ?", [icon, a.id]);
    count++;
  }
  after(res, { count });
});

router.get("/settings", async (req, res) => res.json(await getSettings()));
router.put("/settings", async (req, res) => {
  const body = req.body || {};
  for (const [k, v] of Object.entries(body)) {
    const val = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
    await run("INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [k, val]);
  }
  after(res);
});

router.get("/users", async (req, res) =>
  res.json((await all("SELECT id, username, role, admin_level, nickname, nickname_color, role_color, created_at FROM users ORDER BY id")).map((u) => ({ ...u, id: String(u.id), adminLevel: u.admin_level || "" })))
);
router.put("/users/:id", async (req, res) => {
  const u = await get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (!u) return res.status(404).json({ error: "not found" });
  let role = u.role;
  let adminLevel = u.admin_level || "";
  if (req.body.role === "admin") {
    role = "admin";
    adminLevel = adminLevel === "owner" ? "owner" : "limited";
  }
  if (req.body.role === "user") {
    if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "cannot change yourself" });
    role = "user";
    adminLevel = "";
  }
  await run("UPDATE users SET nickname=?, nickname_color=?, role_color=?, role=?, admin_level=? WHERE id=?", [
    req.body.nickname ?? u.nickname,
    req.body.nickname_color ?? u.nickname_color,
    req.body.role_color ?? u.role_color,
    role,
    adminLevel,
    req.params.id
  ]);
  after(res);
});
router.delete("/users/:id", async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "cannot delete yourself" });
  const u = await get("SELECT * FROM users WHERE id = ?", [req.params.id]);
  if (u?.admin_level === "owner") return res.status(400).json({ error: "cannot delete owner admin" });
  await run("DELETE FROM users WHERE id = ?", [req.params.id]);
  after(res);
});

router.get("/comments", async (req, res) => {
  const rows = await all(`SELECT c.*, l.title AS link_title FROM comments c LEFT JOIN links l ON l.id = c.link_id ORDER BY c.id DESC`);
  res.json(rows.map((c) => ({ id: String(c.id), linkId: String(c.link_id), linkTitle: c.link_title || c.link_id, user: c.nickname, content: c.content, image: c.image_url, time: c.created_at })));
});
router.delete("/comments/:id", async (req, res) => {
  const c = await get("SELECT * FROM comments WHERE id = ?", [req.params.id]);
  if (c && c.image_url && c.image_url.startsWith("/uploads/")) {
    const p = join(DATA_DIR, c.image_url.replace("/uploads/", "uploads/"));
    if (existsSync(p)) try { unlinkSync(p); } catch {}
  }
  await run("DELETE FROM comments WHERE id = ?", [req.params.id]);
  after(res);
});

router.get("/submissions", async (req, res) =>
  res.json((await all("SELECT * FROM submissions ORDER BY id DESC")).map((s) => ({ id: String(s.id), title: s.title, url: s.url, desc: s.descr, cat: s.cat_id ? String(s.cat_id) : "", status: s.status, time: s.created_at })))
);
router.post("/submissions/:id/approve", async (req, res) => {
  const s = await get("SELECT * FROM submissions WHERE id = ?", [req.params.id]);
  if (!s) return res.status(404).json({ error: "未找到" });
  const catId = s.cat_id || (await get("SELECT id FROM categories ORDER BY sort, id LIMIT 1"))?.id;
  const sort = (await get("SELECT COALESCE(MIN(sort),0)-1 AS s FROM links")).s;
  await run("INSERT INTO links (cat_id, sub, title, url, domain, descr, badge, sort) VALUES (?,?,?,?,?,?,?,?)", [
    catId, "", s.title, s.url, getDomain(s.url), s.descr, "", sort
  ]);
  await run("UPDATE submissions SET status = '已通过' WHERE id = ?", [s.id]);
  after(res);
});
router.post("/submissions/:id/reject", async (req, res) => { await run("UPDATE submissions SET status = '已拒绝' WHERE id = ?", [req.params.id]); after(res); });
router.delete("/submissions/:id", async (req, res) => { await run("DELETE FROM submissions WHERE id = ?", [req.params.id]); after(res); });

router.get("/stats", async (req, res) => {
  const d = new Date().toLocaleDateString("sv-SE");
  const todayRow = (await get("SELECT pv, uv FROM stats_daily WHERE date = ?", [d])) || { pv: 0, uv: 0 };
  const totalPv = (await get("SELECT COALESCE(SUM(pv),0) AS s FROM stats_daily")).s;
  const totalUv = (await get("SELECT COALESCE(SUM(uv),0) AS s FROM stats_daily")).s;
  const linkViews = (await get("SELECT COALESCE(SUM(views),0) AS s FROM links")).s;
  const comments = (await get("SELECT COUNT(*) AS c FROM comments")).c;
  const submissions = (await get("SELECT COUNT(*) AS c FROM submissions")).c;
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toLocaleDateString("sv-SE");
    const row = (await get("SELECT pv, uv FROM stats_daily WHERE date = ?", [day])) || { pv: 0, uv: 0 };
    series.push({ date: day.slice(5), pv: row.pv, uv: row.uv });
  }
  const visits = (await all("SELECT id, ip, path, referer, user_agent, created_at FROM visit_logs ORDER BY id DESC LIMIT 80")).map((v) => ({
    id: String(v.id),
    ip: v.ip,
    path: v.path || "/",
    referer: v.referer || "",
    browser: browserName(v.user_agent || ""),
    time: v.created_at
  }));
  res.json({ todayPv: todayRow.pv, todayUv: todayRow.uv, totalPv, totalUv, linkViews, comments, submissions, series, visits });
});

export default router;
