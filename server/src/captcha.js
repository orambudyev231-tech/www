import crypto from "crypto";

// 内存存储验证码：token -> { text, expire }
const store = new Map();
const TTL = 5 * 60 * 1000; // 5 分钟
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混字符

function randText(n = 4) {
  let s = "";
  for (let i = 0; i < n; i++) s += CHARS[crypto.randomInt(CHARS.length)];
  return s;
}

function rand(min, max) {
  return min + crypto.randomInt(max - min);
}

function buildSvg(text) {
  const w = 120;
  const h = 40;
  const colors = ["#4f6ef7", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];
  let body = "";
  // 干扰线
  for (let i = 0; i < 4; i++) {
    body += `<line x1="${rand(0, w)}" y1="${rand(0, h)}" x2="${rand(0, w)}" y2="${rand(0, h)}" stroke="${colors[rand(0, colors.length)]}" stroke-width="1" opacity="0.5"/>`;
  }
  // 干扰点
  for (let i = 0; i < 24; i++) {
    body += `<circle cx="${rand(0, w)}" cy="${rand(0, h)}" r="1" fill="${colors[rand(0, colors.length)]}" opacity="0.6"/>`;
  }
  // 字符
  text.split("").forEach((ch, i) => {
    const x = 16 + i * 26;
    const y = rand(26, 32);
    const rot = rand(-20, 20);
    const color = colors[rand(0, colors.length)];
    body += `<text x="${x}" y="${y}" font-size="${rand(22, 28)}" font-family="Arial,sans-serif" font-weight="700" fill="${color}" transform="rotate(${rot} ${x} ${y})">${ch}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#f3f4f6"/>${body}</svg>`;
}

function cleanup() {
  const now = Date.now();
  for (const [k, v] of store) if (v.expire < now) store.delete(k);
}

// 生成验证码：返回 { token, image(dataURL) }
export function create() {
  cleanup();
  const text = randText(4);
  const token = crypto.randomBytes(16).toString("hex");
  store.set(token, { text, expire: Date.now() + TTL });
  const svg = buildSvg(text);
  const image = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
  return { token, image };
}

// 校验：一次性消费，大小写不敏感
export function verify(token, input) {
  if (!token || !input) return false;
  const item = store.get(token);
  if (!item) return false;
  store.delete(token); // 一次性
  if (item.expire < Date.now()) return false;
  return item.text.toUpperCase() === String(input).trim().toUpperCase();
}
