import { existsSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "./db/index.js";

const ICONS_DIR = join(DATA_DIR, "icons");
const HIGH_ICON_EXTS = ["svg", "png", "webp", "jpg"];
const LOW_ICON_EXTS = ["ico", "gif"];
const ICON_EXTS = [...HIGH_ICON_EXTS, ...LOW_ICON_EXTS];
const MISS_CACHE_MS = 24 * 60 * 60 * 1000;

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

export async function fetchIcon(domain) {
  const d = normalizeDomain(domain);
  if (!d) return "";
  const cached = cachedIcon(d, { allowLow: false });
  if (cached === "miss") return "";
  if (cached) return cached;

  for (const url of iconUrls(d)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = imageExt(buf);
      if (!ext) continue;
      const file = `${safeName(d)}.${ext}`;
      writeFileSync(join(ICONS_DIR, file), buf);
      return `/icons/${file}`;
    } catch {
      // Try the next favicon candidate.
    }
  }
  const lowCached = cachedIcon(d);
  if (lowCached && lowCached !== "miss") return lowCached;
  writeFileSync(join(ICONS_DIR, `${safeName(d)}.miss`), String(Date.now()));
  return "";
}
