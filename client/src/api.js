// 接口封装：JWT 存 localStorage(nav_token)，相对路径(换域名/经中转都正常)
const TOKEN_KEY = "nav_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function req(path, { method = "GET", body, form } = {}) {
  const headers = {};
  const tk = getToken();
  if (tk) headers.Authorization = "Bearer " + tk;
  const opts = { method, headers };
  if (form) {
    opts.body = form; // FormData：浏览器自动设 Content-Type
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch("/api" + path, opts);
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  if (res.status === 401) setToken(null);
  if (!res.ok) throw new Error((data && data.error) || "请求失败 (" + res.status + ")");
  return data;
}

export const api = {
  get: (p) => req(p),
  post: (p, body) => req(p, { method: "POST", body }),
  put: (p, body) => req(p, { method: "PUT", body }),
  del: (p) => req(p, { method: "DELETE" }),
  upload: (p, form) => req(p, { method: "POST", form })
};
