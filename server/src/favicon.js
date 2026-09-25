import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";
import { lookup as dnsLookup } from "dns/promises";
import { gunzipSync, brotliDecompressSync, inflateSync } from "zlib";
import { DATA_DIR } from "./db/index.js";

const ICONS_DIR = join(DATA_DIR, "icons");
const HIGH_ICON_EXTS = ["svg", "png", "webp", "jpg"];
const LOW_ICON_EXTS = ["ico", "gif"];
const ICON_EXTS = [...HIGH_ICON_EXTS, ...LOW_ICON_EXTS];
const MISS_CACHE_MS = 24 * 60 * 60 * 1000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// 自建 favicon 反代（worker/favicon-worker.js 部署后填自定义域），如 https://icon.example.com
function iconProxyBase() {
  return (process.env.ICON_PROXY_URL || "").trim().replace(/\/+$/, "");
}

// ---------- 抓取用 HTTP 客户端 ----------
// 不直接用全局 fetch，因为：
// 1) fetch 走系统 DNS，运营商污染域名（解析成 0.0.0.0）时直接失败，
//    这里在系统解析失败/结果异常时改用阿里公共 DNS 的 DoH 接口（按 IP 访问，不受污染影响）；
// 2) fetch 跟随重定向不带 Set-Cookie，过不了"307 到 /auth 发 Cookie 再跳回"这类防护门。

const BOGUS_IPS = new Set(["0.0.0.0", "::", "::1", "127.0.0.1"]);
const dnsCache = new Map(); // host -> { ip, exp }

function isIpLiteral(host) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
}

function isBogusIp(ip) {
  return !ip || BOGUS_IPS.has(ip) || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|198\.18\.|100\.6[4-9]\.)/.test(ip);
}

async function dohResolve(host) {
  for (const api of [
    `https://223.5.5.5/resolve?name=${encodeURIComponent(host)}&type=A`,
    `https://223.6.6.6/resolve?name=${encodeURIComponent(host)}&type=A`
  ]) {
    try {
      const res = await fetch(api, { signal: AbortSignal.timeout(3000), headers: { Accept: "application/dns-json" } });
      if (!res.ok) continue;
      const j = await res.json();
      const a = (j.Answer || []).find((x) => x.type === 1 && !isBogusIp(x.data));
      if (a) return a.data;
    } catch {
      // 换下一个 DoH 服务
    }
  }
  return "";
}

async function resolveHost(host) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const c = dnsCache.get(host);
  if (c && c.exp > Date.now()) return c.ip;
  let ip = "";
  try {
    const r = await dnsLookup(host, { family: 4 });
    if (!isBogusIp(r?.address)) ip = r.address;
  } catch {
    // 系统 DNS 失败，走 DoH
  }
  if (!ip) ip = await dohResolve(host);
  if (ip) dnsCache.set(host, { ip, exp: Date.now() + 10 * 60 * 1000 });
  return ip;
}

function decodeBody(buf, encoding) {
  try {
    if (encoding === "gzip") return gunzipSync(buf);
    if (encoding === "br") return brotliDecompressSync(buf);
    if (encoding === "deflate") return inflateSync(buf);
  } catch {
    // 解压失败按原始内容处理
  }
  return buf;
}

const MAX_BODY = 3 * 1024 * 1024;

function rawRequest(url, { ip, headers, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === "https:";
    let connected = false; // TCP/TLS 已握手：主机可达，只是响应慢，不能按"不可达"处理
    const req = (isHttps ? httpsRequest : httpRequest)(
      {
        host: ip,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        // 按 IP 直连时靠 SNI + Host 命中站点（SNI 不允许填 IP）。
        // 不校验证书：目标站大量是自签/IP 直连站，抓的只是图片且有魔数校验，无敏感数据
        ...(isHttps ? { ...(isIpLiteral(u.hostname) ? {} : { servername: u.hostname }), rejectUnauthorized: false } : {}),
        headers: { Host: u.hostname, ...headers },
        timeout: timeoutMs
      },
      (res) => {
        connected = true;
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > MAX_BODY) {
            req.destroy();
            return resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) });
          }
          chunks.push(c);
        });
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, buf: decodeBody(Buffer.concat(chunks), res.headers["content-encoding"]) })
        );
        res.on("error", reject);
      }
    );
    req.on("socket", (s) => {
      const ev = isHttps ? "secureConnect" : "connect";
      if (!s.connecting) connected = true;
      else s.once(ev, () => (connected = true));
    });
    req.on("timeout", () => {
      const e = new Error("timeout");
      e.connected = connected;
      req.destroy(e);
    });
    req.on("error", (e) => {
      if (e.connected === undefined) e.connected = connected;
      reject(e);
    });
    req.end();
  });
}

// 过防护门拿到的 Cookie 按主机复用，避免每次抓取都重走 /auth（有的站会对反复过门限速）
const cookieJar = new Map(); // host -> { cookies: Map, exp }

function hostCookies(host) {
  const c = cookieJar.get(host);
  if (c && c.exp > Date.now()) return c.cookies;
  const cookies = new Map();
  cookieJar.set(host, { cookies, exp: Date.now() + 10 * 60 * 1000 });
  if (cookieJar.size > 500) cookieJar.delete(cookieJar.keys().next().value);
  return cookies;
}

// 带 Cookie 的重定向跟随。抛出的异常带 reachable 标记：
// true = 主机可达（握手成功/拿到过响应），只是慢或中途失败；false = 网络层不可达（DNS/被墙）
export async function fetchBuf(url, { accept = "*/*", timeoutMs = 4000, maxHops = 5 } = {}) {
  let sawResponse = false;
  let current = url;
  for (let hop = 0; hop < maxHops; hop++) {
    const u = new URL(current);
    const ip = await resolveHost(u.hostname);
    if (!ip) {
      const e = new Error(`DNS failed: ${u.hostname}`);
      e.reachable = sawResponse;
      throw e;
    }
    const cookies = hostCookies(u.hostname);
    const headers = { "User-Agent": UA, Accept: accept, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" };
    if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    let res;
    try {
      res = await rawRequest(current, { ip, headers, timeoutMs });
    } catch (e) {
      e.reachable = sawResponse || Boolean(e.connected);
      throw e;
    }
    sawResponse = true;
    for (const sc of [].concat(res.headers["set-cookie"] || [])) {
      const m = /^([^=;]+)=([^;]*)/.exec(sc);
      if (m) cookies.set(m[1].trim(), m[2]);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, current).href;
      continue;
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, buf: res.buf, url: current };
  }
  const e = new Error("too many redirects");
  e.reachable = true;
  throw e;
}

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

function iconHosts(domain) {
  const d = normalizeDomain(domain);
  if (!d) return [];
  // IP 直连或带端口的站不加 www 变体
  if (d.startsWith("www.") || isIpLiteral(d)) return [d];
  return [d, `www.${d}`];
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
  // 声明的图标全部失效时的最后兜底：页面里 "logo" 命名的图片（img/JS/CSS 内的引用都扫）
  const logos = [];
  const text = html.replace(/\\\//g, "/"); // JS 字符串里的 \/ 还原
  for (const m of text.matchAll(/["'(=]([^"'()<>\s]*logo[^"'()<>\s]*\.(?:png|svg|webp|jpe?g|gif)(?:\?[^"'()<>\s]*)?)/gi)) {
    if (!logos.includes(m[1])) logos.push(m[1]);
    if (logos.length >= 5) break;
  }
  // apple-touch-icon 通常尺寸最大放最前，og:image 次之，logo 图片最后
  icons.sort((a, b) => Number(b.touch) - Number(a.touch));
  const out = [];
  for (const raw of [...icons.map((i) => i.url), ...images, ...logos.map(decodeEntities)]) {
    try {
      const u = new URL(raw, base);
      if (["http:", "https:", "data:"].includes(u.protocol) && !out.includes(u.href)) out.push(u.href);
    } catch {
      // 忽略无法解析的地址
    }
  }
  return out;
}

// 首页常见的 JS / meta refresh 跳转（如 location.href = '/xxx'），取跳转目标。
// 按源码顺序取第一个 location 赋值：字面量直接用；是变量/三元表达式时回查变量的字符串赋值
function htmlRedirectTarget(html, base) {
  let raw = "";
  const assign = /(?:window\.|top\.|self\.)?location(?:\.href)?\s*=(?!=)\s*([^;\n]{1,160})|location\.replace\(\s*([^)\n]{1,160})/i.exec(html);
  const rhs = (assign?.[1] || assign?.[2] || "").trim();
  if (rhs) {
    const lit = /^["']([^"']+)["']/.exec(rhs);
    if (lit) {
      raw = lit[1];
    } else {
      const skip = new Set(["window", "location", "href", "document", "top", "self", "true", "false", "null", "undefined"]);
      for (const ident of rhs.match(/[A-Za-z_$][\w$]*/g) || []) {
        if (skip.has(ident)) continue;
        const def = new RegExp(`\\b${ident.replace(/\$/g, "\\$")}\\s*=\\s*["']([^"']+)["']`).exec(html);
        if (def) {
          raw = def[1];
          break;
        }
      }
    }
  }
  if (!raw) {
    const meta = /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"'\s>]+)/i.exec(html);
    raw = meta?.[1] || "";
  }
  raw = decodeEntities(raw);
  if (!raw) return "";
  try {
    const u = new URL(raw, base);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}

// 抓取网站首页，解析 <link rel="...icon..."> 与 og:image / twitter:image 声明的图片。
// 跳转壳页面常声明一个坏图标，所以即使解析到了也继续跟跳转，把各页候选都收集起来
export async function pageIconUrls(domain) {
  const d = normalizeDomain(domain);
  const found = [];
  const seen = new Set();
  for (const start of [`https://${d}/`, `http://${d}/`]) {
    let url = start;
    // 最多跟随 2 次页面内跳转（JS / meta refresh）
    for (let hop = 0; hop <= 2 && url && !seen.has(url); hop++) {
      seen.add(url);
      try {
        const res = await fetchBuf(url, { accept: "text/html,*/*", timeoutMs: 6000 });
        if (!res.ok) break;
        const html = res.buf.toString("utf8").slice(0, 300_000);
        const base = res.url || url;
        for (const u of parseIconsFromHtml(html, base)) {
          if (!found.includes(u)) found.push(u);
        }
        url = htmlRedirectTarget(html, base);
      } catch {
        break; // 换下一个协议重试
      }
    }
    if (found.length) break; // https 已有结果就不再试 http
  }
  return found;
}

// 返回 { icon, unreachable }：unreachable 表示网络层失败（DNS/超时/被墙），
// 与 HTTP 404 等区分开，便于快速跳过连不上的主机，避免逐个 URL 等超时
async function saveIfImage(url, domain, timeoutMs = 4000) {
  try {
    let buf;
    if (url.startsWith("data:")) {
      // HTML 里内联的 data: 图标
      const m = /^data:[^;,]*(;base64)?,([\s\S]*)$/.exec(url);
      if (!m) return { icon: "" };
      buf = m[1] ? Buffer.from(m[2], "base64") : Buffer.from(decodeURIComponent(m[2]), "utf8");
    } else {
      const res = await fetchBuf(url, { accept: "image/*,*/*", timeoutMs });
      if (!res.ok) return { icon: "" };
      buf = res.buf;
    }
    const ext = imageExt(buf);
    if (!ext) return { icon: "" };
    const file = `${safeName(domain)}.${ext}`;
    writeFileSync(join(ICONS_DIR, file), buf);
    return { icon: `/icons/${file}` };
  } catch (e) {
    // fastFail：连接被立刻拒绝/协议不匹配（如对 HTTP-only 站发 HTTPS）——主机是活的，
    // 换协议还有戏；timeout 才是疑似被墙/宕机，后续跳过
    return { icon: "", unreachable: !e.reachable, fastFail: e.message !== "timeout" };
  }
}

// 下载指定图片 URL 存为本地上传图标（up_ 前缀，重抓图标时不会覆盖）
export async function saveRemoteImage(url) {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return "";
    const res = await fetchBuf(url, { accept: "image/*,*/*", timeoutMs: 8000 });
    if (!res.ok) return "";
    const ext = imageExt(res.buf);
    if (!ext) return "";
    const file = `up_${crypto.randomBytes(6).toString("hex")}.${ext}`;
    writeFileSync(join(ICONS_DIR, file), res.buf);
    return `/icons/${file}`;
  } catch {
    return "";
  }
}

// 手动"重新抓取图标"时清掉未命中标记，让 24 小时内失败过的域名也重试
export function clearMissMarkers() {
  try {
    for (const f of readdirSync(ICONS_DIR)) {
      if (f.endsWith(".miss")) rmSync(join(ICONS_DIR, f), { force: true });
    }
  } catch {
    // 目录不存在等情况忽略
  }
}

export async function fetchIcon(domain) {
  const d = normalizeDomain(domain);
  if (!d) return "";
  const cached = cachedIcon(d, { allowLow: false });
  if (cached === "miss") return "";
  if (cached) return cached;

  const hosts = iconHosts(d);
  const unreachable = new Set();
  let anyAlive = false; // 有主机秒拒（协议不匹配等）说明站是活的，可能只支持 http

  // 1) 直连站点常规高清路径；主机超时（被墙/宕机）就跳过它的其余路径
  for (const host of hosts) {
    for (const path of ["apple-touch-icon.png", "apple-touch-icon-precomposed.png", "favicon.svg", "favicon.png"]) {
      const r = await saveIfImage(`https://${host}/${path}`, d);
      if (r.icon) return r.icon;
      if (r.unreachable) {
        unreachable.add(host);
        if (r.fastFail) anyAlive = true;
        break;
      }
    }
  }

  // 2) 抓首页 HTML 解析声明的图标 / og:image（内部先 https 后 http，HTTP-only 站靠这里兜住；
  //    防护门站点响应慢，预算给足）。全部主机都超时才跳过
  if (unreachable.size < hosts.length || anyAlive) {
    for (const url of await pageIconUrls(d)) {
      const r = await saveIfImage(url, d, 6000);
      if (r.icon) return r.icon;
    }
  }

  // 3) 自建反代（境外 Cloudflare Worker，能抓到国内直连不到的站）
  const proxy = iconProxyBase();
  if (proxy) {
    const r = await saveIfImage(`${proxy}/${encodeURIComponent(d)}`, d, 15000);
    if (r.icon) return r.icon;
  }

  // 4) 公共镜像：t3.gstatic.cn 是 Google favicon 服务的国内可访问镜像（思路来自 iowen/getFavicon）
  for (const host of hosts) {
    const r = await saveIfImage(
      `https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=${encodeURIComponent(`https://${host}`)}`,
      d
    );
    if (r.icon) return r.icon;
  }

  // 5) 直连 /favicon.ico（低清兜底，只试可达主机；http 给纯 http 老站留一次机会）
  for (const host of hosts) {
    if (unreachable.has(host)) continue;
    const r = await saveIfImage(`https://${host}/favicon.ico`, d);
    if (r.icon) return r.icon;
  }
  {
    const r = await saveIfImage(`http://${d}/favicon.ico`, d);
    if (r.icon) return r.icon;
  }

  // 6) google.com 直连最后再试（国内基本不通，海外部署时仍有用）
  {
    const r = await saveIfImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`, d);
    if (r.icon) return r.icon;
  }

  const lowCached = cachedIcon(d);
  if (lowCached && lowCached !== "miss") return lowCached;
  writeFileSync(join(ICONS_DIR, `${safeName(d)}.miss`), String(Date.now()));
  return "";
}
