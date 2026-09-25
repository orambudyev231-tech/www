// 自建 favicon 反代服务（Cloudflare Worker，单文件无依赖）
//
// 用途：主站服务器（国内）访问不到境外网站和 Google 图标服务时，
//      由部署在 Cloudflare 边缘的本 Worker 代为抓取图标并返回图片字节。
//
// 部署：Cloudflare 控制台 → Workers → 新建 Worker → 粘贴本文件 → 部署。
//      ⚠️ *.workers.dev 域名在国内被墙，必须给 Worker 绑定自定义域
//      （Worker → 设置 → 域和路由 → 添加自定义域，如 icon.example.com）。
//      然后在主站 server/.env 加：ICON_PROXY_URL=https://icon.example.com
//
// 接口：GET /<domain>  或  GET /?domain=<domain>
//      命中返回图片（Cache-Control 7 天），取不到返回 404（主站会走后续兜底）。

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const FETCH_TIMEOUT = 5000;
const OK_CACHE = "public, max-age=604800";   // 命中缓存 7 天
const MISS_CACHE = "public, max-age=3600";   // 未命中缓存 1 小时

const CT = {
  ico: "image/x-icon",
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml"
};

function normalizeDomain(domain) {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\/\//, "")
    .split("/")[0]
    .split("?")[0]
    .replace(/^www\./i, "")
    .toLowerCase();
}

function imageExt(buf) {
  const b = new Uint8Array(buf);
  if (b.length < 4) return "";
  const ascii = (s, e) => String.fromCharCode(...b.subarray(s, e));
  if (b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0) return "ico";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (ascii(0, 3) === "GIF") return "gif";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  const head = new TextDecoder().decode(b.subarray(0, 200)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return "";
}

// 手动跟随重定向并携带 Set-Cookie：可以过"307 到 /auth 发 Cookie 再跳回"这类防护门
async function fetchBytes(url, accept = "*/*") {
  const cookies = new Map();
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    let res;
    try {
      res = await fetch(current, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        redirect: "manual",
        headers: {
          "User-Agent": UA,
          Accept: accept,
          ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {})
        }
      });
    } catch {
      return null;
    }
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
    for (const sc of setCookies) {
      const m = /^([^=;]+)=([^;]*)/.exec(sc);
      if (m) cookies.set(m[1].trim(), m[2]);
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).href;
      continue;
    }
    if (!res.ok) return null;
    return { buf: await res.arrayBuffer(), url: current };
  }
  return null;
}

async function tryImage(url) {
  const got = await fetchBytes(url, "image/*,*/*");
  if (!got) return null;
  const ext = imageExt(got.buf);
  return ext ? { buf: got.buf, ext } : null;
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');
}

// 解析首页 HTML 里的 <link rel="...icon..."> 与 og:image / twitter:image
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

async function findIcon(domain) {
  const hosts = [domain, `www.${domain}`];

  // 1) 站点常规高清路径
  for (const host of hosts) {
    for (const path of ["apple-touch-icon.png", "apple-touch-icon-precomposed.png", "favicon.svg", "favicon.png"]) {
      const hit = await tryImage(`https://${host}/${path}`);
      if (hit) return hit;
    }
  }

  // 2) 抓首页解析声明的图标
  for (const start of [`https://${domain}/`, `http://${domain}/`]) {
    const page = await fetchBytes(start, "text/html,*/*");
    if (!page) continue;
    const html = new TextDecoder("utf-8", { fatal: false }).decode(page.buf.slice(0, 300_000));
    for (const url of parseIconsFromHtml(html, page.url).slice(0, 5)) {
      const hit = await tryImage(url);
      if (hit) return hit;
    }
    break; // https 能拿到页面就不再试 http
  }

  // 3) /favicon.ico 直连
  for (const host of hosts) {
    const hit = await tryImage(`https://${host}/favicon.ico`);
    if (hit) return hit;
  }

  // 4) Google 图标服务兜底（Worker 在境外边缘，可达）
  for (const url of [
    `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=128&url=${encodeURIComponent(`https://${domain}`)}`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`
  ]) {
    const hit = await tryImage(url);
    if (hit) return hit;
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const domain = normalizeDomain(url.searchParams.get("domain") || url.searchParams.get("url") || decodeURIComponent(url.pathname.slice(1)));
    if (!domain || !domain.includes(".")) {
      return new Response("usage: /<domain> or /?domain=<domain>", { status: 400 });
    }

    // 边缘缓存：同一域名 7 天内直接回缓存
    const cacheKey = new Request(`https://favicon-proxy.cache/${domain}`);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const hit = await findIcon(domain);
    const res = hit
      ? new Response(hit.buf, {
          headers: {
            "Content-Type": CT[hit.ext] || "application/octet-stream",
            "Cache-Control": OK_CACHE,
            "Access-Control-Allow-Origin": "*"
          }
        })
      : new Response("icon not found", { status: 404, headers: { "Cache-Control": MISS_CACHE } });

    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  }
};
