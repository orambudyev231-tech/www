import { writeFileSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "./db/index.js";

const ICONS_DIR = join(DATA_DIR, "icons");

export function googleIcon(domain) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

function safeName(domain) {
  return domain.replace(/[^a-z0-9.-]/gi, "_");
}

// 抓取站点图标存到 data/icons，返回 /icons/xxx.png；失败返回 google 服务地址
export async function fetchIcon(domain) {
  if (!domain) return "";
  try {
    const res = await fetch(googleIcon(domain), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("bad status");
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error("empty");
    const file = `${safeName(domain)}.png`;
    writeFileSync(join(ICONS_DIR, file), buf);
    return `/icons/${file}`;
  } catch {
    // 抓取失败时退回到在线服务
    return googleIcon(domain);
  }
}
