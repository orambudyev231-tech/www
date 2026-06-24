import { all, get } from "./db/index.js";

function parseGrad(s) {
  if (!s) return undefined;
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) && arr.length ? arr : undefined;
  } catch {
    return undefined;
  }
}

export function serializeLink(l) {
  const subs = all("SELECT title, url FROM sub_links WHERE link_id = ?", [l.id]);
  return {
    id: String(l.id),
    cat: String(l.cat_id),
    sub: l.sub || "",
    title: l.title,
    desc: l.descr || "",
    url: l.url,
    domain: l.domain || "",
    badge: l.badge || "",
    views: l.views || 0,
    icon: l.icon || "",
    visible: l.visible !== 0,
    descGradient: parseGrad(l.desc_gradient),
    titleColor: l.title_color || "",
    descColor: l.desc_color || "",
    badgeColor: l.badge_color || "",
    subs
  };
}

export function serializeAd(a) {
  const subs = all("SELECT title, url FROM ad_sub_links WHERE ad_id = ?", [a.id]);
  return {
    id: String(a.id),
    title: a.title,
    desc: a.descr || "",
    url: a.url,
    domain: a.domain || "",
    badge: a.badge || "",
    icon: a.icon || "",
    visible: a.visible !== 0,
    descGradient: parseGrad(a.desc_gradient),
    titleColor: a.title_color || "",
    descColor: a.desc_color || "",
    badgeColor: a.badge_color || "",
    subs
  };
}

export function serializeCategory(c) {
  const subs = all("SELECT name FROM sub_categories WHERE cat_id = ? ORDER BY sort, id", [c.id]).map((s) => s.name);
  return { id: String(c.id), name: c.name, group: c.page_group || "home", visible: c.visible !== 0, subs };
}

export function getSettings() {
  const rows = all("SELECT key, value FROM settings");
  const o = {};
  rows.forEach((r) => (o[r.key] = r.value));
  o.popupEnabled = o.popupEnabled !== "0";
  return o;
}

export function getPublicData(group) {
  let cats = all("SELECT * FROM categories WHERE visible = 1 ORDER BY sort, id");
  if (group) cats = cats.filter((c) => (c.page_group || "home") === group);
  const categories = cats.map(serializeCategory);

  const links = all("SELECT * FROM links WHERE visible = 1 ORDER BY sort, id").map(serializeLink);
  const ads = all("SELECT * FROM ads WHERE visible = 1 ORDER BY position, id").map(serializeAd);
  const banners = all("SELECT url FROM banners WHERE visible = 1 ORDER BY sort, id").map((b) => b.url);
  const notices = all("SELECT text FROM notices WHERE visible = 1 ORDER BY sort, id").map((n) => n.text);
  const navs = all("SELECT name FROM navs WHERE visible = 1 ORDER BY sort, id").map((n) => n.name);

  return { settings: getSettings(), categories, links, ads, banners, notices, navs };
}

export function serializeComment(c) {
  return {
    id: String(c.id),
    user: c.nickname || "用户",
    role: c.role || "",
    content: c.content,
    image: c.image_url || "",
    time: c.created_at
  };
}
