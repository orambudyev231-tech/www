import { existsSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "./db/index.js";

const ICONS_DIR = join(DATA_DIR, "icons");
const HIGH_ICON_EXTS = ["svg", "png", "webp", "jpg"];
const LOW_ICON_EXTS = ["ico", "gif"];
const ICON_EXTS = [...HIGH_ICON_EXTS, ...LOW_ICON_EXTS];
const MISS_CACHE_MS = 24 * 60 * 60 * 1000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function normalizeDomain(domain) {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\/\//, "")
    .split("/")[0]
    .replace(/^www\./i, "");
}

function safeName(domain) {
  return normalizeDomain(domain).replace(/[^a-z0-9.-]/gi, "_");
}

function iconUrls(domain) {
  const d = normalizeDomain(domain);
  if (!d) return [];
  const hosts = d.startsWith("www.") ? [d] : [d, `www.${d}`];
  return hosts.flatMap((host) => [
    `https://${host}/apple-touch-icon.png`,
    `https://${host}/apple-touch-icon-precomposed.png`,
    `https://${host}/favicon.svg`,
    `https://${host}/favicon.png`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
    `https://${host}/favicon.ico`,
    `http://${host}/favicon.ico`
  ]);
}

function imageExt(buf) {
  const textStart = buf.subarray(0, 120).toString("utf8").trimStart().toLowerCase();
  if (buf[0] === 0 && buf[1] === 0 && (buf[2] === 1 || buf[2] === 2) && buf[3] === 0) return "ico";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 3).toString("ascii") === "GIF") return "gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (textStart.startsWith("<svg")) return "svg";
  return "";
}

function cachedIcon(domain, { allowLow = true } = {}) {
  const name = safeName(domain);
  for (const ext of HIGH_ICON_EXTS) {
    const file = `${name}.${ext}`;
    if (existsSync(join(ICONS_DIR, file))) return `/icons/${file}`;
  }
  if (allowLow) {
    for (const ext of LOW_ICON_EXTS) {
      const file = `${name}.${ext}`;
      if (existsSync(join(ICONS_DIR, file))) return `/icons/${file}`;
    }
  }
  const missFile = join(ICONS_DIR, `${name}.miss`);
  if (existsSync(missFile) && Date.now() - statSync(missFile).mtimeMs < MISS_CACHE_MS) return "miss";
  return "";
}

export function fallbackIconSvg(domain = "") {
  const label = (normalizeDomain(domain).match(/[a-z0-9]/i)?.[0] || "?").toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#eef2ff"/>
  <circle cx="32" cy="32" r="22" fill="#4f6ef7"/>
  <text x="32" y="40" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="white">${label}</text>
</svg>`;
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');
}

function parseIconsFromHtml(html, base) {
  const icons = [];
  const images = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = /rel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() || "";
    if (!rel.includes("icon")) continue;
    const href = /href\s*=\s*["']([^"']+)["']|href\s*=\s*([^\s>]+)/i.exec(tag);
    const raw = decodeEntities(href?.[1] || href?.[2] || "");
    if (raw) icons.push({ url: raw, touch: rel.includes("apple-touch") });
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = /(?:property|name)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    if (key !== "og:image" && key !== "twitter:image") continue;
    const content = /content\s*=\s*["']([^"']+)["']|content\s*=\s*([^\s>]+)/i.exec(tag);
    const raw = decodeEntities(content?.[1] || content?.[2] || "");
    if (raw) images.push(raw);
  }
  // apple-touch-icon 通常尺寸最大放最前，og:image 只作兜底
  icons.sort((a, b) => Number(b.touch) - Number(a.touch));
  const out = [];
  for (const raw of [...icons.map((i) => i.url), ...images]) {
    try {
      const u = new URL(raw, base);
      if (["http:", "https:", "data:"].includes(u.protocol)) out.push(u.href);
    } catch {
      // 忽略无法解析的地址
    }
  }
  return out;
}

// 首页常见的 JS / meta refresh 跳转（如 location.href = '/xxx'），取跳转目标
function htmlRedirectTarget(html, base) {
  const js = /(?:location\.href|location\.replace\(|window\.location(?:\.href)?)\s*=?\s*\(?\s*["']([^"']+)["']/i.exec(html);
  const meta = /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"'\s>]+)/i.exec(html);
  const raw = decodeEntities(js?.[1] || meta?.[1] || "");
  if (!raw) return "";
  try {
    const u = new URL(raw, base);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}

// 抓取网站首页，解析 <link rel="...icon..."> 与 og:image / twitter:image 声明的图片
async function pageIconUrls(domain) {
  const d = normalizeDomain(domain);
  for (const start of [`https://${d}/`, `http://${d}/`]) {
    let url = start;
    // 最多跟随 2 次页面内跳转（JS / meta refresh）
    for (let hop = 0; hop <= 2 && url; hop++) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(4000),
          headers: { "User-Agent": UA, Accept: "text/html,*/*" }
        });
        if (!res.ok) break;
        const html = (await res.text()).slice(0, 300_000);
        const base = res.url || url;
        const out = parseIconsFromHtml(html, base);
        if (out.length) return out;
        url = htmlRedirectTarget(html, base);
      } catch {
        break; // 换下一个协议重试
      }
    }
  }
  return [];
}

async function saveIfImage(url, domain) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { "User-Agent": UA } });
    if (!res.ok) return "";
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = imageExt(buf);
    if (!ext) return "";
    const file = `${safeName(domain)}.${ext}`;
    writeFileSync(join(ICONS_DIR, file), buf);
    return `/icons/${file}`;
  } catch {
    return "";
  }
}

export async function fetchIcon(domain) {
  const d = normalizeDomain(domain);
  if (!d) return "";
  const cached = cachedIcon(d, { allowLow: false });
  if (cached === "miss") return "";
  if (cached) return cached;

  for (const url of iconUrls(d)) {
    const icon = await saveIfImage(url, d);
    if (icon) return icon;
  }
  // 标准路径都取不到时，抓首页 HTML 里声明的图标/站点图片
  for (const url of await pageIconUrls(d)) {
    const icon = await saveIfImage(url, d);
    if (icon) return icon;
  }
  const lowCached = cachedIcon(d);
  if (lowCached && lowCached !== "miss") return lowCached;
  writeFileSync(join(ICONS_DIR, `${safeName(d)}.miss`), String(Date.now()));
  return "";
}
