import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  BarChart3, Bell, BookOpen, Check, ChevronRight, FileText, FolderTree, Home as HomeIcon,
  Image as ImageIcon, LayoutDashboard, Lock, LogIn, Megaphone, Menu, MessageSquare,
  Navigation, Palette, Plus, RefreshCw, Search, Send, Settings, Shield, Sparkles, Tags,
  Trash2, User, Users, X
} from "lucide-react";
import { api, getToken, setToken } from "./api";

// 图标：优先用后端抓取/上传的本站图标，否则在线服务兜底
const iconSrc = (link) => (link.icon ? link.icon : `https://www.google.com/s2/favicons?domain=${link.domain}&sz=64`);

const EMPTY = { settings: {}, categories: [], links: [], ads: [], banners: [], notices: [], navs: [] };

/* ============ 验证码 hook + 组件 ============ */
function useCaptcha() {
  const tokenRef = useRef("");
  const [image, setImage] = useState("");
  const [input, setInput] = useState("");
  const refresh = useCallback(async () => {
    try {
      const c = await api.get("/public/captcha");
      tokenRef.current = c.token;
      setImage(c.image);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return {
    image, input, setInput, refresh,
    token: () => tokenRef.current,
    reset: () => { setInput(""); refresh(); }
  };
}

function CaptchaBox({ cap }) {
  return (
    <label className="cmt-captcha-box">
      <input value={cap.input} onChange={(e) => cap.setInput(e.target.value)} placeholder="验证码" />
      {cap.image
        ? <img className="cmt-captcha-img" src={cap.image} alt="验证码" title="点击换一张" onClick={cap.refresh} />
        : <span className="cmt-captcha-img" onClick={cap.refresh}>···</span>}
    </label>
  );
}

/* ============ App 根 ============ */
function App() {
  const [data, setData] = useState(EMPTY);
  const [user, setUser] = useState(null);
  const [hideNav, setHideNav] = useState(false);

  const refreshData = useCallback(async () => {
    try { setData(await api.get("/public/data")); } catch { /* ignore */ }
  }, []);

  // 初始加载 + 恢复登录态
  useEffect(() => {
    refreshData();
    if (getToken()) api.get("/auth/me").then((r) => setUser(r.user)).catch(() => setToken(null));
    api.post("/public/visit", {}).catch(() => {});
  }, [refreshData]);

  // 应用全局颜色变量
  useEffect(() => {
    if (!data.settings || !data.settings.colors) return;
    try {
      const colors = JSON.parse(data.settings.colors);
      Object.entries(colors).forEach(([k, v]) => v && document.documentElement.style.setProperty(k, v));
    } catch { /* ignore */ }
  }, [data.settings]);

  // SSE 实时刷新 + 20 秒轮询兜底
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("update", refreshData);
    const poll = setInterval(refreshData, 20000);
    return () => { es.close(); clearInterval(poll); };
  }, [refreshData]);

  // 滚动隐藏底部导航
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const cur = window.scrollY;
      setHideNav(cur > last && cur > 80);
      last = cur;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 全站 20 分钟无操作自动退出
  useEffect(() => {
    if (!user) return;
    let timer;
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => { setToken(null); setUser(null); }, 20 * 60 * 1000); };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => { clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [user]);

  const logout = () => { setToken(null); setUser(null); };

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<Home data={data} user={user} />} />
        <Route path="/sites/:id" element={<SiteDetail data={data} user={user} />} />
        <Route path="/login" element={<Login setUser={setUser} />} />
        <Route path="/submit" element={<Submit data={data} user={user} />} />
        <Route path="/me" element={<Me user={user} logout={logout} data={data} />} />
        <Route path="/admin/*" element={<Admin user={user} data={data} refreshData={refreshData} logout={logout} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <BottomNav hidden={hideNav} />
    </div>
  );
}

/* ============ 公共头部 ============ */
function Header({ data, user, onMenu, search, setSearch }) {
  const s = data.settings || {};
  return (
    <header className="site-header">
      <div className="header-inner">
        <button className="hamburger-btn" onClick={onMenu} aria-label="打开分类"><Menu size={20} /></button>
        <Link to="/" className="header-logo">
          <span className="logo-mark">{s.logoText || "导"}</span>
          <span>
            <div className="site-title">{s.title || "导航站"}</div>
            <div className="site-subtitle">{s.subtitle || ""}</div>
          </span>
        </Link>
        <label className="search-box">
          <Search size={17} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={s.searchPlaceholder || "搜索网站、描述或分类"} />
        </label>
        <div className="header-right">
          {user ? <Link className="ghost-btn" to="/me"><User size={15} />{user.nickname || user.username}</Link> : <Link className="ghost-btn" to="/login"><LogIn size={15} />登录</Link>}
          <Link className="admin-btn" to="/admin"><Shield size={15} />管理后台</Link>
        </div>
      </div>
    </header>
  );
}

/* ============ 首页 ============ */
function Home({ data, user }) {
  const [activeCat, setActiveCat] = useState("");
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [popup, setPopup] = useState(null);
  const s = data.settings || {};
  const [notice, setNotice] = useState(false);

  useEffect(() => {
    if (s.popupEnabled && s.noticeTitle && sessionStorage.getItem("notice-ok") !== "1") setNotice(true);
  }, [s.popupEnabled, s.noticeTitle]);

  const q = search.trim().toLowerCase();
  const match = (link) => !q || [link.title, link.desc, link.sub].join(" ").toLowerCase().includes(q);
  const visibleCats = data.categories.filter((cat) => !q || data.links.some((l) => l.cat === cat.id && match(l)));

  return (
    <>
      <Header data={data} user={user} search={search} setSearch={setSearch} onMenu={() => setDrawer(true)} />
      <div className="home-body">
        {drawer && <div className="home-drawer-overlay" onClick={() => setDrawer(false)} />}
        <aside className={`home-sidebar ${drawer ? "open" : ""}`}>
          <nav>
            {data.categories.map((cat) => (
              <button key={cat.id} className={`cat-btn ${activeCat === cat.id ? "active" : ""}`} onClick={() => { setActiveCat(cat.id); setDrawer(false); document.getElementById(`cat-${cat.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                {cat.name}<ChevronRight size={14} />
              </button>
            ))}
          </nav>
          <Link className="admin-btn drawer-admin-btn" to="/admin"><Shield size={15} />管理后台</Link>
        </aside>
        <main className="main-col">
          <NavBar navs={data.navs} />
          {data.banners[0] && <Banner src={data.banners[0]} />}
          {data.notices.length > 0 && <Marquee notices={data.notices} />}
          {data.ads.length > 0 && <Ads ads={data.ads} />}
          {visibleCats.map((cat) => {
            const links = data.links.filter((l) => l.cat === cat.id && match(l));
            if (!links.length) return null;
            return <CategorySection key={cat.id} cat={cat} links={links} onOpen={setPopup} />;
          })}
        </main>
      </div>
      {popup && <LinkPopup link={popup} onClose={() => setPopup(null)} />}
      {notice && (
        <div className="notice-bg">
          <div className="notice-card">
            <button className="popup-close" style={{ position: "absolute", top: 12, right: 12 }} onClick={() => setNotice(false)}><X size={15} /></button>
            <h2>{s.noticeTitle}</h2>
            {s.noticeImage && <img src={s.noticeImage} alt="公告图片" />}
            <p>{s.noticeText}</p>
            <div className="notice-foot">
              <button className="ghost-btn" onClick={() => { sessionStorage.setItem("notice-ok", "1"); setNotice(false); }}>今日不再提示</button>
              <button className="primary-btn" onClick={() => setNotice(false)}><Check size={15} />知道了</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NavBar({ navs }) {
  return <div className="nav-bar">{navs.map((n, i) => <a key={`${n}-${i}`} href="#top">{n}</a>)}</div>;
}

function Banner({ src }) {
  return <div className="banner-wrap"><img className="banner-img" src={src} alt="导航站横幅" /></div>;
}

function Marquee({ notices }) {
  const items = [...notices, ...notices];
  return (
    <div className="marquee marquee-neon">
      <Bell size={17} color="#f9a8d4" />
      <div className="marquee-viewport">
        <div className="marquee-track">
          {items.map((item, i) => <span className="marquee-item marquee-grad" key={`${item}-${i}`}>{item}</span>)}
        </div>
      </div>
    </div>
  );
}

function gradStyle(arr) {
  if (!arr || !arr.length) return undefined;
  const stops = arr.length === 1 ? [arr[0], arr[0]] : arr;
  return {
    background: `linear-gradient(90deg, ${stops.join(", ")})`,
    backgroundSize: "200% auto",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
    color: "transparent"
  };
}

function Ads({ ads }) {
  const circleClass = ads.length >= 5 ? "ad-c5" : "ad-c4";
  return (
    <section className="ads-wrap">
      <div className="ads-header">
        <div className="ads-header-left"><span className="ads-dot" /><span className="ads-title">推荐广告</span></div>
        <Link to="/submit" className="muted">我要推广</Link>
      </div>
      <div className={`ads-row ad-circle ${circleClass}`}>
        {ads.map((ad) => (
          <a className="ad-card" href={ad.url} target="_blank" rel="noreferrer" key={ad.id}>
            <span className="ad-ic"><img src={iconSrc(ad)} alt="" /></span>
            <span className="ad-tx">
              <div className="ad-title">{ad.title}</div>
              <div className="ad-desc grad-text" style={gradStyle(ad.descGradient)}>{ad.desc}</div>
            </span>
            {ad.badge && <span className="ad-badge">{ad.badge}</span>}
          </a>
        ))}
      </div>
    </section>
  );
}

function CategorySection({ cat, links, onOpen }) {
  const [activeSub, setActiveSub] = useState("");
  const shown = activeSub ? links.filter((l) => l.sub === activeSub) : links;
  return (
    <section className="section-card fade-in" id={`cat-${cat.id}`}>
      <div className="section-head">
        <div className="section-title"><BookOpen size={18} color="var(--primary)" /><h2>{cat.name}</h2></div>
        <div className="sub-tabs">
          {cat.subs.length > 0 && <span className={`sub-tab ${activeSub === "" ? "active" : ""}`} onClick={() => setActiveSub("")}>全部</span>}
          {cat.subs.map((sub) => <span className={`sub-tab ${activeSub === sub ? "active" : ""}`} key={sub} onClick={() => setActiveSub(activeSub === sub ? "" : sub)}>{sub}</span>)}
        </div>
      </div>
      <div className="link-grid">
        {shown.map((link) => <button className="link-card" key={link.id} onClick={() => onOpen(link)}><LinkCardContent link={link} /></button>)}
      </div>
      {shown.length === 0 && <div className="sub-empty">该子分类暂无内容</div>}
    </section>
  );
}

function LinkCardContent({ link }) {
  return (
    <>
      <span className="card-ico"><img src={iconSrc(link)} alt="" /></span>
      <span className="link-card-text">
        <span className="link-title" style={link.titleColor ? { color: link.titleColor } : undefined}>{link.title}{link.badge && <span className="badge" style={link.badgeColor ? { background: link.badgeColor } : undefined}>{link.badge}</span>}</span>
        <span className="link-desc grad-text" style={gradStyle(link.descGradient) || (link.descColor ? { color: link.descColor } : undefined)}>{link.desc}</span>
      </span>
    </>
  );
}

function LinkPopup({ link, onClose }) {
  const open = (url) => {
    api.get(`/public/link/${link.id}`).catch(() => {}); // 浏览 +1
    window.open(url, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="popup-bg" onClick={onClose}>
      <div className="popup" onClick={(e) => e.stopPropagation()}>
        <div className="popup-header">
          <strong>{link.title}</strong>
          <button className="popup-close" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="popup-links">
          <button className="popup-item" onClick={() => open(link.url)}>
            <span className="popup-tag">主站</span>
            <span className="popup-item-text"><span className="popup-item-title">{link.title}</span><span className="popup-item-url">{link.url}</span></span>
          </button>
          {link.subs.map((sub) => (
            <button className="popup-item" key={sub.url} onClick={() => open(sub.url)}>
              <span className="popup-tag">子链</span>
              <span className="popup-item-text"><span className="popup-item-title">{sub.title}</span><span className="popup-item-url">{sub.url}</span></span>
            </button>
          ))}
        </div>
        <Link className="primary-btn popup-detail-btn" to={`/sites/${link.id}`}>查看详情与评论</Link>
      </div>
    </div>
  );
}

/* ============ 详情页 ============ */
function SiteDetail({ data, user }) {
  const { id } = useParams();
  const [link, setLink] = useState(null);
  const [cat, setCat] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [comments, setComments] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [content, setContent] = useState("");
  const [image, setImage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const cap = useCaptcha();

  const loadComments = useCallback(async (offset = 0) => {
    const r = await api.get(`/public/comments/${id}?offset=${offset}&limit=20`);
    setTotal(r.total);
    setHasMore(r.hasMore);
    setComments((prev) => (offset === 0 ? r.comments : [...prev, ...r.comments]));
  }, [id]);

  useEffect(() => {
    api.get(`/public/link/${id}`).then((r) => { setLink(r.link); setCat(r.category); }).catch(() => setNotFound(true));
    loadComments(0).catch(() => {});
    api.post("/public/visit", {}).catch(() => {});
  }, [id, loadComments]);

  if (notFound) return <NotFound />;
  if (!link) return <main className="form-page"><div className="form-card"><h1>加载中…</h1></div></main>;

  const pickImage = async (file) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("image", file);
      const r = await api.upload("/public/comment-image", form);
      setImage(r.url);
    } catch (e) { setError(e.message); }
    setUploading(false);
  };

  const postComment = async () => {
    setError("");
    if (!user) return setError("请先登录后再评论。");
    if (!content.trim()) return setError("请输入评论内容。");
    try {
      await api.post("/public/comment", { linkId: id, content, image, captchaToken: cap.token(), captcha: cap.input });
      setContent(""); setImage(""); cap.reset();
      loadComments(0);
    } catch (e) { setError(e.message); cap.reset(); }
  };

  return (
    <>
      <header className="detail-header">
        <div className="detail-header-inner">
          <Link to="/" className="header-logo"><span className="logo-mark">{data.settings.logoText || "导"}</span><strong>{data.settings.title || "导航站"}</strong></Link>
          <Link className="ghost-btn" to="/">返回首页</Link>
        </div>
      </header>
      <main className="detail-body">
        <div className="crumb"><Link to="/">首页</Link><span>/</span><span>{cat?.name}</span><span>/</span><strong>{link.title}</strong></div>
        {data.banners[0] && <Banner src={data.banners[0]} />}
        {data.notices.length > 0 && <Marquee notices={data.notices} />}
        {data.ads.length > 0 && <Ads ads={data.ads.slice(0, 4)} />}
        <section className="detail-card">
          <div className="detail-title-row">
            <img className="detail-icon" src={iconSrc(link)} alt="" />
            <h1 className="detail-h1">{link.title}</h1>
            <span className="detail-tag">{cat?.name}</span>
            <a className="detail-open-btn" href={link.url} target="_blank" rel="noreferrer">打开网站</a>
            <div className="detail-sub-wrap">{link.subs.map((sub) => <a className="detail-sub-link" href={sub.url} target="_blank" rel="noreferrer" key={sub.url}>{sub.title}</a>)}</div>
          </div>
          <p className="detail-desc">{link.desc}。当前浏览量 {link.views}，支持主链接、子链接和评论互动。</p>
        </section>
        <section className="comments-card">
          <div className="cmt-title">评论区（{total}）</div>
          {comments.map((c) => (
            <div className="cmt-item" key={c.id}>
              <div className="cmt-head">
                <span className="cmt-avatar">{(c.user || "U").slice(0, 1).toUpperCase()}</span>
                <span className="cmt-name">{c.user}</span>
                {c.role && <span className="badge">{c.role}</span>}
                <span className="cmt-time">{c.time}</span>
              </div>
              <div className="cmt-content">{c.content}</div>
              {c.image && <img className="cmt-image" src={c.image} alt="评论图片" style={{ maxWidth: 160, borderRadius: 10, marginTop: 6, display: "block" }} />}
            </div>
          ))}
          {hasMore && <button className="cmt-more-btn" onClick={() => loadComments(comments.length)}>加载更多评论</button>}
          <div className="cmt-form">
            <textarea className="cmt-textarea" value={content} onChange={(e) => setContent(e.target.value)} placeholder={user ? "写下你的评论" : "请先登录后评论"} />
            {image && <div style={{ marginTop: 8 }}><img src={image} alt="预览" style={{ maxWidth: 120, borderRadius: 8 }} /> <button className="ghost-btn" onClick={() => setImage("")}>移除</button></div>}
            <div className="cmt-tool-row">
              <label className="cmt-img-btn">{uploading ? "上传中" : "图片"}<input type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files[0])} /></label>
              <CaptchaBox cap={cap} />
              <button className="cmt-submit-btn" onClick={postComment}>发表评论</button>
            </div>
            {error && <div className="error">{error}</div>}
          </div>
        </section>
      </main>
    </>
  );
}

/* ============ 登录 / 注册 ============ */
function Login({ setUser }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ username: "", password: "", nickname: "" });
  const [error, setError] = useState("");
  const cap = useCaptcha();
  const navigate = useNavigate();

  const submit = async () => {
    setError("");
    if (!form.username || !form.password) return setError("请输入用户名和密码。");
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const r = await api.post(path, { ...form, captchaToken: cap.token(), captcha: cap.input });
      setToken(r.token);
      setUser(r.user);
      navigate("/");
    } catch (e) { setError(e.message); cap.reset(); }
  };

  return (
    <main className="form-page">
      <div className="form-card">
        <h1>{mode === "login" ? "登录" : "注册"}</h1>
        <div className="field"><label>用户名</label><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
        {mode === "register" && <div className="field"><label>昵称</label><input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} /></div>}
        <div className="field"><label>密码</label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
        <div className="form-row">
          <div className="field" style={{ flex: 1 }}><label>图形验证码</label><input value={cap.input} onChange={(e) => cap.setInput(e.target.value)} /></div>
          {cap.image ? <img className="cmt-captcha-img" src={cap.image} alt="验证码" onClick={cap.refresh} style={{ height: 40, marginTop: 22 }} /> : <button className="cmt-captcha-img" onClick={cap.refresh}>···</button>}
        </div>
        <button className="primary-btn" style={{ width: "100%", justifyContent: "center" }} onClick={submit}><Lock size={15} />{mode === "login" ? "登录" : "注册"}</button>
        <button className="ghost-btn" style={{ width: "100%", justifyContent: "center", marginTop: 10 }} onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "没有账号，去注册" : "已有账号，去登录"}</button>
        {error && <div className="error">{error}</div>}
        <p className="muted" style={{ marginTop: 12 }}>默认管理员 admin / admin123</p>
      </div>
    </main>
  );
}

/* ============ 投稿 ============ */
function Submit({ data, user }) {
  const [form, setForm] = useState({ title: "", url: "", desc: "", cat: "" });
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!form.cat && data.categories[0]) setForm((f) => ({ ...f, cat: data.categories[0].id })); }, [data.categories, form.cat]);

  const submit = async () => {
    setError("");
    if (!user) return setError("投稿需要先登录。");
    if (!form.title || !form.url) return setError("请填写名称和链接。");
    try {
      await api.post("/public/submission", form);
      setDone(true);
      setForm({ title: "", url: "", desc: "", cat: data.categories[0]?.id || "" });
    } catch (e) { setError(e.message); }
  };

  return (
    <main className="form-page">
      <div className="form-card">
        <h1>网站投稿</h1>
        {!user && <p className="error">投稿需要先登录。</p>}
        <div className="field"><label>网站名称</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div className="field"><label>主链接</label><input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" /></div>
        <div className="field"><label>描述</label><textarea value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} /></div>
        <div className="field"><label>分类</label><select value={form.cat} onChange={(e) => setForm({ ...form, cat: e.target.value })}>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <button className="primary-btn" style={{ width: "100%", justifyContent: "center" }} onClick={submit}><Send size={15} />提交审核</button>
        {done && <div className="success">投稿已进入后台审核队列。</div>}
        {error && <div className="error">{error}</div>}
      </div>
    </main>
  );
}

/* ============ 我的 ============ */
function Me({ user, logout, data }) {
  const [pw, setPw] = useState({ oldPassword: "", newPassword: "" });
  const [msg, setMsg] = useState("");
  const changePw = async () => {
    setMsg("");
    try { await api.post("/auth/change-password", pw); setMsg("密码已修改。"); setPw({ oldPassword: "", newPassword: "" }); }
    catch (e) { setMsg(e.message); }
  };
  return (
    <main className="form-page">
      <div className="form-card">
        <h1>我的</h1>
        {user ? (
          <>
            <p>昵称：{user.nickname}</p>
            <p className="muted">角色：{user.role === "admin" ? "管理员" : "普通用户"}</p>
            <div className="field" style={{ marginTop: 14 }}><label>原密码</label><input type="password" value={pw.oldPassword} onChange={(e) => setPw({ ...pw, oldPassword: e.target.value })} /></div>
            <div className="field"><label>新密码</label><input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></div>
            <button className="ghost-btn" style={{ width: "100%", justifyContent: "center" }} onClick={changePw}>修改密码</button>
            {msg && <div className="muted" style={{ marginTop: 8 }}>{msg}</div>}
            {user.role === "admin" && <Link className="primary-btn" to="/admin" style={{ width: "100%", justifyContent: "center", marginTop: 12 }}>进入后台</Link>}
            <button className="ghost-btn" style={{ width: "100%", justifyContent: "center", marginTop: 16 }} onClick={logout}>退出登录</button>
          </>
        ) : (
          <>
            <p className="muted">登录后可以投稿、评论并查看个人状态。</p>
            <Link className="primary-btn" to="/login" style={{ width: "100%", justifyContent: "center", marginTop: 16 }}>去登录</Link>
          </>
        )}
        <p className="muted" style={{ marginTop: 18 }}>当前收录 {data.links.length} 个站点。</p>
      </div>
    </main>
  );
}

/* ============ 后台 ============ */
function Admin({ user, data, refreshData, logout }) {
  const [tab, setTab] = useState("links");
  const [drawer, setDrawer] = useState(false);
  const [adStyle, setAdStyle] = useState(() => localStorage.getItem("admin-ad-style") || "1");
  const isAdmin = user?.role === "admin";

  useEffect(() => { localStorage.setItem("admin-ad-style", adStyle); }, [adStyle]);

  // 后台 10 分钟无操作自动退出
  useEffect(() => {
    if (!isAdmin) return;
    let timer;
    const reset = () => { clearTimeout(timer); timer = setTimeout(logout, 10 * 60 * 1000); };
    const events = ["mousemove", "keydown", "click"];
    events.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => { clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [isAdmin, logout]);

  const tabs = [
    ["links", "链接管理", LayoutDashboard],
    ["categories", "分类管理", FolderTree],
    ["subcats", "子分类", Tags],
    ["navs", "导航管理", Navigation],
    ["pages", "页面管理", FileText],
    ["ads", "广告管理", Megaphone],
    ["notices", "跑马灯", Bell],
    ["banners", "图片管理", ImageIcon],
    ["colors", "颜色管理", Palette],
    ["gradients", "颜色渐变", Sparkles],
    ["stats", "访客统计", BarChart3],
    ["users", "用户管理", Users],
    ["popup", "弹窗公告", MessageSquare],
    ["settings", "网站设置", Settings]
  ];
  const currentTitle = tabs.find(([id]) => id === tab)?.[1] || "管理后台";

  if (!isAdmin) {
    return (
      <main className="form-page">
        <div className="form-card">
          <h1>管理后台</h1>
          <p className="muted">请使用管理员账号登录。默认 admin / admin123。</p>
          <Link className="primary-btn" to="/login" style={{ marginTop: 16 }}>去登录</Link>
        </div>
      </main>
    );
  }

  return (
    <div className="admin-wrap">
      {drawer && <div className="admin-overlay" onClick={() => setDrawer(false)} />}
      <aside className={`admin-sidebar ${drawer ? "open" : ""}`}>
        <div className="admin-side-top">
          <span className="admin-brand-icon">导</span>
          <span><strong>导航后台</strong><small>{user.nickname || user.username} · 管理员</small></span>
        </div>
        <nav className="admin-menu">
          {tabs.map(([id, label, Icon]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setDrawer(false); }}><Icon size={16} />{label}</button>
          ))}
        </nav>
        <div className="admin-side-bottom">
          <Link to="/" className="admin-side-link">返回前台</Link>
          <button className="admin-side-link" onClick={logout}>退出登录</button>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <button className="admin-menu-btn" onClick={() => setDrawer(true)}><Menu size={20} /></button>
          <div className="admin-page-title">{currentTitle}</div>
          <div className="admin-ad-style">
            <span>手机广告样式</span>
            <div className="admin-switch">
              <button className={adStyle === "1" ? "active" : ""} onClick={() => setAdStyle("1")}>1</button>
              <button className={adStyle === "2" ? "active" : ""} onClick={() => setAdStyle("2")}>2</button>
            </div>
          </div>
          <span className="admin-user-chip">{user.nickname || user.username}</span>
        </header>
        <section className="admin-content">
          {tab === "links" && <LinksAdmin data={data} sync={refreshData} />}
          {tab === "categories" && <CategoriesAdmin data={data} sync={refreshData} />}
          {tab === "subcats" && <SubCategoriesAdmin data={data} sync={refreshData} />}
          {tab === "navs" && <NavsAdmin sync={refreshData} />}
          {tab === "pages" && <PagesAdmin sync={refreshData} />}
          {tab === "ads" && <AdsAdmin sync={refreshData} />}
          {tab === "notices" && <NoticesAdmin sync={refreshData} />}
          {tab === "banners" && <BannersAdmin sync={refreshData} />}
          {tab === "colors" && <ColorsAdmin data={data} sync={refreshData} />}
          {tab === "gradients" && <GradientsAdmin data={data} sync={refreshData} />}
          {tab === "stats" && <StatsAdmin />}
          {tab === "users" && <UsersAdmin data={data} sync={refreshData} />}
          {tab === "popup" && <PopupAdmin sync={refreshData} />}
          {tab === "settings" && <SettingsPanel sync={refreshData} />}
        </section>
      </main>
    </div>
  );
}

function AdminHeader({ title, children }) {
  return <div className="admin-panel-head"><h1>{title}</h1><div className="admin-actions">{children}</div></div>;
}

function AdminTable({ columns, rows, minWidth = 760 }) {
  const cols = columns.map((c) => c.size || "1fr").join(" ");
  return (
    <div className="admin-table-wrap">
      <div className="admin-table" style={{ minWidth }}>
        <div className="admin-table-row head" style={{ gridTemplateColumns: cols }}>
          {columns.map((c) => <span key={c.key}>{c.label}</span>)}
        </div>
        {rows.length ? rows.map((row) => (
          <div className="admin-table-row" style={{ gridTemplateColumns: cols }} key={row.id}>
            {columns.map((c) => <span key={c.key}>{c.render ? c.render(row) : row[c.key]}</span>)}
          </div>
        )) : <div className="admin-empty">暂无数据</div>}
      </div>
    </div>
  );
}

// 通用 hook：从后台接口加载资源
function useAdminList(path) {
  const [rows, setRows] = useState([]);
  const load = useCallback(() => api.get(path).then(setRows).catch(() => {}), [path]);
  useEffect(() => { load(); }, [load]);
  return [rows, load];
}

function LinksAdmin({ data, sync }) {
  const [rows, load] = useAdminList("/admin/links");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [modal, setModal] = useState(null); // 弹窗：null | {id?, title, url, cat, sub, badge, desc, subs, icon, iconFile, iconPreview}
  const reload = () => { load(); sync(); };
  const filtered = rows.filter((l) => (cat === "all" || l.cat === cat) && [l.title, l.url, l.desc, l.sub].join(" ").toLowerCase().includes(q.toLowerCase()));
  const openAdd = () => setModal({ title: "", url: "", cat: data.categories[0]?.id || "", sub: "", badge: "", desc: "", subs: [], subDraft: { title: "", url: "" }, icon: "", iconFile: null, iconPreview: "" });
  const openEdit = (r) => setModal({ ...r, subs: (r.subs || []).map((s) => ({ title: s.title, url: s.url })), subDraft: { title: "", url: "" }, iconFile: null, iconPreview: "" });
  const save = async () => {
    if (!modal.title || !modal.url) return;
    const body = { title: modal.title, url: modal.url, cat: modal.cat, sub: modal.sub, badge: modal.badge, desc: modal.desc };
    let id = modal.id;
    if (id) await api.put(`/admin/links/${id}`, body);
    else { const r = await api.post("/admin/links", body); id = r.id; }
    // 子链接：整体替换
    await api.put(`/admin/links/${id}/subs`, { subs: (modal.subs || []).filter((s) => s.title && s.url) });
    // 本地图标上传（存为 up_，重抓图标时不覆盖）
    if (modal.iconFile) {
      const form = new FormData();
      form.append("icon", modal.iconFile);
      form.append("linkId", id);
      await api.upload("/admin/upload-icon", form);
    }
    setModal(null);
    reload();
  };
  const remove = async (id) => { await api.del(`/admin/links/${id}`); reload(); };
  const toggle = async (l) => { await api.put(`/admin/links/${l.id}`, { visible: !l.visible }); reload(); };
  const refetch = async () => { await api.post("/admin/refetch-icons", {}); reload(); };
  const set = (k, v) => setModal((m) => ({ ...m, [k]: v }));
  const updateSubDraft = (k, v) => setModal((m) => ({ ...m, subDraft: { ...m.subDraft, [k]: v } }));
  const addSub = () => setModal((m) => {
    const d = m.subDraft || { title: "", url: "" };
    if (!d.title.trim() || !d.url.trim()) return m;
    return { ...m, subs: [...(m.subs || []), { title: d.title.trim(), url: d.url.trim() }], subDraft: { title: "", url: "" } };
  });
  const removeSub = (i) => setModal((m) => ({ ...m, subs: m.subs.filter((_, j) => j !== i) }));
  const pickIcon = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setModal((m) => ({ ...m, iconFile: file, iconPreview: reader.result }));
    reader.readAsDataURL(file);
  };
  return (
    <div className="admin-card">
      <AdminHeader title="链接管理">
        <button className="ghost-btn" onClick={refetch}><RefreshCw size={15} />重抓图标</button>
        <button className="primary-btn" onClick={openAdd}><Plus size={15} />新增链接</button>
      </AdminHeader>
      <div className="admin-filter-bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题、URL、描述" />
        <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">全部分类</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <span className="count-badge">{filtered.length} 条</span>
      </div>
      <AdminTable minWidth={940} columns={[
        { key: "title", label: "标题", size: "1.2fr", render: (r) => <strong>{r.title}</strong> },
        { key: "cat", label: "分类", render: (r) => `${data.categories.find((c) => c.id === r.cat)?.name || r.cat}/${r.sub || ""}` },
        { key: "url", label: "URL", size: "2fr" },
        { key: "views", label: "浏览", size: "70px" },
        { key: "visible", label: "状态", size: "90px", render: (r) => <button className={`admin-badge ${r.visible ? "green" : ""}`} onClick={() => toggle(r)}>{r.visible ? "显示" : "隐藏"}</button> },
        { key: "action", label: "操作", size: "150px", render: (r) => <span className="row-actions"><button className="mini-btn green" onClick={() => openEdit(r)}>编辑</button><button className="mini-btn red" onClick={() => remove(r.id)}><Trash2 size={13} />删除</button></span> }
      ]} rows={filtered} />
      {modal && (
        <div className="edit-overlay" onClick={() => setModal(null)}>
          <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-panel-head"><h1>{modal.id ? "编辑链接" : "新增链接"}</h1><button className="popup-close" onClick={() => setModal(null)}><X size={15} /></button></div>
            <div className="admin-grid modal-grid2">
              <div className="field"><label>标题</label><input autoFocus value={modal.title} onChange={(e) => set("title", e.target.value)} /></div>
              <div className="field"><label>链接</label><input value={modal.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" /></div>
              <div className="field full">
                <label className="sublink-label">子链接 <span className="sublink-count">({(modal.subs || []).length} 条)</span></label>
                {(modal.subs || []).length > 0 && (
                  <div className="sublink-list">
                    {modal.subs.map((s, i) => (
                      <div className="sublink-item" key={i}>
                        <span className="sublink-item-title">{s.title}</span>
                        <span className="sublink-item-url">{s.url}</span>
                        <button className="sublink-del" onClick={() => removeSub(i)} aria-label="删除子链接"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="sublink-add-row">
                  <input className="sublink-title-input" placeholder="标题 *" value={modal.subDraft.title} onChange={(e) => updateSubDraft("title", e.target.value)} />
                  <input className="sublink-url-input" placeholder="URL (https://...) *" value={modal.subDraft.url} onChange={(e) => updateSubDraft("url", e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSub())} />
                  <button className="primary-btn sublink-add-btn" onClick={addSub}><Plus size={15} />添加</button>
                </div>
                <div className="sublink-hint">提示：子链接将在保存主链接后一并创建</div>
              </div>
              <div className="field"><label>分类</label><select value={modal.cat} onChange={(e) => set("cat", e.target.value)}>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div className="field"><label>子分类</label>
                <select value={modal.sub || ""} onChange={(e) => set("sub", e.target.value)}>
                  <option value="">（无）</option>
                  {(data.categories.find((c) => c.id === modal.cat)?.subs || []).map((s) => <option key={s} value={s}>{s}</option>)}
                  {modal.sub && !(data.categories.find((c) => c.id === modal.cat)?.subs || []).includes(modal.sub) && <option value={modal.sub}>{modal.sub}（自定义）</option>}
                </select>
              </div>
              <div className="field"><label>角标</label><input value={modal.badge || ""} onChange={(e) => set("badge", e.target.value)} /></div>
              <div className="field full"><label>描述</label><input value={modal.desc || ""} onChange={(e) => set("desc", e.target.value)} /></div>
              <div className="field full">
                <label>图标（上传本地图标，重抓图标时不会覆盖）</label>
                <div className="icon-row">
                  <span className="icon-preview"><img src={modal.iconPreview || iconSrc({ icon: modal.icon, domain: (modal.url || "").replace(/^https?:\/\//, "").split("/")[0] })} alt="" /></span>
                  <label className="ghost-btn">上传本地图标<input type="file" accept="image/*" hidden onChange={(e) => pickIcon(e.target.files[0])} /></label>
                  {modal.iconFile && <span className="muted">已选择：{modal.iconFile.name}</span>}
                  {!modal.iconFile && modal.icon && /\/icons\/up_/.test(modal.icon) && <span className="muted">当前为本地上传图标</span>}
                </div>
              </div>
            </div>
            <div className="edit-foot">
              {modal.id && <Link className="ghost-btn" to={`/sites/${modal.id}`}>查看详情</Link>}
              <span style={{ flex: 1 }} />
              <button className="ghost-btn" onClick={() => setModal(null)}>取消</button>
              <button className="primary-btn" onClick={save}>{modal.id ? "保存" : "新增"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoriesAdmin({ data, sync }) {
  const [rows, load] = useAdminList("/admin/categories");
  const [name, setName] = useState("");
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const nameRef = useRef(null);
  const reload = () => { load(); sync(); };
  const add = async () => { if (!name.trim()) { nameRef.current?.focus(); return; } await api.post("/admin/categories", { name: name.trim() }); setName(""); reload(); };
  const remove = async (id) => { await api.del(`/admin/categories/${id}`); reload(); };
  const startEdit = (r) => { setEditId(r.id); setEditName(r.name); };
  const cancelEdit = () => { setEditId(null); setEditName(""); };
  const saveEdit = async () => { if (!editName.trim()) return; await api.put(`/admin/categories/${editId}`, { name: editName.trim() }); cancelEdit(); reload(); };
  return (
    <div className="admin-card">
      <AdminHeader title="分类管理">
        <input ref={nameRef} className="head-input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="输入分类名称…" />
        <button className="primary-btn" onClick={add}><Plus size={15} />新增分类</button>
      </AdminHeader>
      <AdminTable columns={[
        { key: "name", label: "分类名称", render: (r) => editId === r.id
          ? <input className="inline-edit-input" value={editName} autoFocus onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }} />
          : <strong>{r.name}</strong> },
        { key: "subs", label: "子分类", render: (r) => r.subs.join("、") || "无" },
        { key: "count", label: "链接数", render: (r) => data.links.filter((l) => l.cat === r.id).length },
        { key: "action", label: "操作", render: (r) => editId === r.id
          ? <span className="row-actions"><button className="mini-btn green" onClick={saveEdit}>保存</button><button className="mini-btn" onClick={cancelEdit}>取消</button></span>
          : <span className="row-actions"><button className="mini-btn green" onClick={() => startEdit(r)}>编辑</button><button className="mini-btn red" onClick={() => remove(r.id)}>删除</button></span> }
      ]} rows={rows} />
    </div>
  );
}

function SubCategoriesAdmin({ data, sync }) {
  const [cats, load] = useAdminList("/admin/categories");
  const [draft, setDraft] = useState({ cat: "", name: "" });
  const nameRef = useRef(null);
  useEffect(() => { if (!draft.cat && cats[0]) setDraft((d) => ({ ...d, cat: cats[0].id })); }, [cats, draft.cat]);
  const reload = () => { load(); sync(); };
  const rows = cats.flatMap((c) => c.subs.map((sub) => ({ id: `${c.id}-${sub}`, catId: c.id, catName: c.name, name: sub })));
  const add = async () => { if (!draft.cat || !draft.name.trim()) { nameRef.current?.focus(); return; } await api.post("/admin/sub-categories", { cat: draft.cat, name: draft.name.trim() }); setDraft({ ...draft, name: "" }); reload(); };
  return (
    <div className="admin-card">
      <AdminHeader title="子分类管理">
        <select className="head-select" value={draft.cat} onChange={(e) => setDraft({ ...draft, cat: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input ref={nameRef} className="head-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="输入子分类名称…" />
        <button className="primary-btn" onClick={add}><Plus size={15} />新增子分类</button>
      </AdminHeader>
      <AdminTable columns={[
        { key: "catName", label: "所属分类" },
        { key: "name", label: "子分类" },
        { key: "count", label: "链接数", render: (r) => data.links.filter((l) => l.cat === r.catId && l.sub === r.name).length }
      ]} rows={rows} />
    </div>
  );
}

function NavsAdmin({ sync }) {
  const [rows, load] = useAdminList("/admin/navs");
  const [draft, setDraft] = useState({ name: "", url: "#" });
  const reload = () => { load(); sync(); };
  const add = async () => { if (!draft.name.trim()) return; await api.post("/admin/navs", draft); setDraft({ name: "", url: "#" }); reload(); };
  const remove = async (id) => { await api.del(`/admin/navs/${id}`); reload(); };
  return (
    <div className="admin-card">
      <AdminHeader title="导航管理"><button className="primary-btn" onClick={add}><Plus size={15} />新增导航</button></AdminHeader>
      <div className="admin-filter-bar">
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="名称" />
        <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="链接" />
      </div>
      <AdminTable columns={[
        { key: "name", label: "名称", render: (r) => <strong>{r.name}</strong> },
        { key: "url", label: "链接" },
        { key: "action", label: "操作", render: (r) => <button className="mini-btn red" onClick={() => remove(r.id)}>删除</button> }
      ]} rows={rows} />
    </div>
  );
}

function PagesAdmin({ sync }) {
  const [rows, load] = useAdminList("/admin/pages");
  const [name, setName] = useState("");
  const reload = () => { load(); sync(); };
  const add = async () => { if (!name.trim()) return; await api.post("/admin/pages", { name: name.trim() }); setName(""); reload(); };
  const remove = async (id) => { await api.del(`/admin/pages/${id}`); reload(); };
  return (
    <div className="admin-card">
      <AdminHeader title="页面管理"><button className="primary-btn" onClick={add}><Plus size={15} />新增页面</button></AdminHeader>
      <div className="admin-filter-bar"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="页面名称" /></div>
      <AdminTable columns={[
        { key: "name", label: "页面名称", render: (r) => <strong>{r.name}</strong> },
        { key: "content", label: "内容", size: "2fr" },
        { key: "action", label: "操作", render: (r) => <button className="mini-btn red" onClick={() => remove(r.id)}>删除</button> }
      ]} rows={rows} />
    </div>
  );
}

function AdsAdmin({ sync }) {
  const [rows, load] = useAdminList("/admin/ads");
  const [draft, setDraft] = useState({ title: "", url: "", desc: "", badge: "AD" });
  const reload = () => { load(); sync(); };
  const add = async () => { if (!draft.title || !draft.url) return; await api.post("/admin/ads", draft); setDraft({ title: "", url: "", desc: "", badge: "AD" }); reload(); };
  const remove = async (id) => { await api.del(`/admin/ads/${id}`); reload(); };
  const toggle = async (a) => { await api.put(`/admin/ads/${a.id}`, { visible: !a.visible }); reload(); };
  return (
    <div className="admin-card">
      <AdminHeader title="广告管理"><button className="primary-btn" onClick={add}><Plus size={15} />新增广告</button></AdminHeader>
      <div className="admin-grid compact">
        <div className="field"><label>标题</label><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
        <div className="field"><label>链接</label><input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} /></div>
        <div className="field"><label>描述</label><input value={draft.desc} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} /></div>
        <div className="field"><label>角标</label><input value={draft.badge} onChange={(e) => setDraft({ ...draft, badge: e.target.value })} /></div>
      </div>
      <AdminTable columns={[
        { key: "title", label: "标题", render: (r) => <strong>{r.title}</strong> },
        { key: "desc", label: "描述" },
        { key: "url", label: "URL", size: "2fr" },
        { key: "visible", label: "状态", size: "90px", render: (r) => <button className={`admin-badge ${r.visible ? "green" : ""}`} onClick={() => toggle(r)}>{r.visible ? "显示" : "隐藏"}</button> },
        { key: "action", label: "操作", render: (r) => <button className="mini-btn red" onClick={() => remove(r.id)}>删除</button> }
      ]} rows={rows} />
    </div>
  );
}

function NoticesAdmin({ sync }) {
  const [rows, load] = useAdminList("/admin/notices");
  const [text, setText] = useState("");
  const reload = () => { load(); sync(); };
  const add = async () => { if (!text.trim()) return; await api.post("/admin/notices", { text: text.trim() }); setText(""); reload(); };
  const remove = async (id) => { await api.del(`/admin/notices/${id}`); reload(); };
  return (
    <div className="admin-card">
      <AdminHeader title="跑马灯管理"><button className="primary-btn" onClick={add}><Plus size={15} />新增公告</button></AdminHeader>
      <div className="admin-filter-bar"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="跑马灯文字" /></div>
      <AdminTable columns={[
        { key: "text", label: "内容", size: "3fr" },
        { key: "action", label: "操作", render: (r) => <button className="mini-btn red" onClick={() => remove(r.id)}>删除</button> }
      ]} rows={rows} />
    </div>
  );
}

function BannersAdmin({ sync }) {
  const [rows, load] = useAdminList("/admin/banners");
  const [url, setUrl] = useState("");
  const reload = () => { load(); sync(); };
  const add = async () => { if (!url.trim()) return; await api.post("/admin/banners", { url: url.trim() }); setUrl(""); reload(); };
  const remove = async (id) => { await api.del(`/admin/banners/${id}`); reload(); };
  return (
    <div className="admin-card">
      <AdminHeader title="图片管理"><button className="primary-btn" onClick={add}><Plus size={15} />新增横幅</button></AdminHeader>
      <div className="admin-filter-bar"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="图片 URL" /></div>
      <div className="banner-admin-grid">
        {rows.map((b, i) => <div className="banner-admin-item" key={b.id}><img src={b.url} alt="" /><span>横幅 {i + 1}</span><button className="mini-btn red" onClick={() => remove(b.id)}>删除</button></div>)}
      </div>
    </div>
  );
}

function ColorsAdmin({ data, sync }) {
  const vars = [["--primary", "主题色"], ["--bg", "背景色"], ["--card-title", "卡片标题"], ["--card-desc", "卡片描述"], ["--ad-title", "广告标题"], ["--badge", "角标色"]];
  const initial = (() => { try { return JSON.parse(data.settings.colors || "{}"); } catch { return {}; } })();
  const [colors, setColors] = useState(() => Object.fromEntries(vars.map(([k]) => [k, initial[k] || getComputedStyle(document.documentElement).getPropertyValue(k).trim() || "#4f6ef7"])));
  const save = async () => {
    Object.entries(colors).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
    await api.put("/admin/settings", { colors: JSON.stringify(colors) });
    sync();
  };
  return (
    <div className="admin-card color-table">
      <AdminHeader title="颜色管理"><button className="primary-btn" onClick={save}>保存颜色</button></AdminHeader>
      {vars.map(([key, label]) => (
        <div className="color-row" key={key}>
          <strong>{label}</strong><code>{key}</code>
          <input type="color" value={colors[key] || "#4f6ef7"} onChange={(e) => setColors({ ...colors, [key]: e.target.value })} />
          <input value={colors[key] || ""} onChange={(e) => setColors({ ...colors, [key]: e.target.value })} />
        </div>
      ))}
    </div>
  );
}

function GradientsAdmin({ data, sync }) {
  const [kind, setKind] = useState("links");
  const [filter, setFilter] = useState("all");
  const rows = (kind === "links" ? data.links : data.ads).filter((r) => kind === "ads" || filter === "all" || r.cat === filter);
  const setGradient = async (row, color, index) => {
    const grad = (row.descGradient && [...row.descGradient]) || ["#60a5fa", "#f472b6", "#60a5fa"];
    grad[index] = color;
    await api.put(`/admin/${kind === "links" ? "links" : "ads"}/${row.id}/desc-gradient`, { gradient: grad });
    sync();
  };
  return (
    <div className="admin-card">
      <div className="admin-panel-head grad-head">
        <div className="grad-tabs">
          <button className={`grad-tab ${kind === "links" ? "active" : ""}`} onClick={() => setKind("links")}>卡片</button>
          <button className={`grad-tab ${kind === "ads" ? "active" : ""}`} onClick={() => setKind("ads")}>广告</button>
        </div>
        <select className="grad-filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部分类</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <AdminTable columns={[
        { key: "title", label: "名称", render: (r) => <strong>{r.title}</strong> },
        { key: "desc", label: "描述", size: "2fr", render: (r) => <span className="grad-text" style={gradStyle(r.descGradient)}>{r.desc}</span> },
        { key: "colors", label: "三色渐变", size: "190px", render: (r) => <span className="gradient-pickers">{(r.descGradient || ["#60a5fa", "#f472b6", "#60a5fa"]).map((color, i) => <input key={i} type="color" value={color} onChange={(e) => setGradient(r, e.target.value, i)} />)}</span> }
      ]} rows={rows} />
    </div>
  );
}

function StatsAdmin() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api.get("/admin/stats").then(setStats).catch(() => {}); }, []);
  if (!stats) return <div className="admin-card"><AdminHeader title="访客统计" /><p className="muted">加载中…</p></div>;
  const max = Math.max(1, ...stats.series.map((d) => d.pv));
  return (
    <div className="admin-card">
      <AdminHeader title="访客统计" />
      <div className="stat-grid">
        <div className="stat-card"><span>今日 PV</span><strong>{stats.todayPv}</strong></div>
        <div className="stat-card"><span>今日 UV</span><strong>{stats.todayUv}</strong></div>
        <div className="stat-card"><span>累计 PV</span><strong>{stats.totalPv}</strong></div>
        <div className="stat-card"><span>链接总点击</span><strong>{stats.linkViews}</strong></div>
        <div className="stat-card"><span>评论/投稿</span><strong>{stats.comments}/{stats.submissions}</strong></div>
      </div>
      <div className="bar-chart">{stats.series.map((d) => <span key={d.date} style={{ height: Math.round((d.pv / max) * 120) + 4 }} title={`${d.date} PV ${d.pv} UV ${d.uv}`} />)}</div>
    </div>
  );
}

function UsersAdmin({ data, sync }) {
  const [view, setView] = useState("users");
  const [users, loadUsers] = useAdminList("/admin/users");
  const [comments, loadComments] = useAdminList("/admin/comments");
  const [subs, loadSubs] = useAdminList("/admin/submissions");
  const approve = async (s) => { await api.post(`/admin/submissions/${s.id}/approve`); loadSubs(); sync(); };
  const reject = async (s) => { await api.post(`/admin/submissions/${s.id}/reject`); loadSubs(); };
  const delSub = async (s) => { await api.del(`/admin/submissions/${s.id}`); loadSubs(); };
  const delComment = async (c) => { await api.del(`/admin/comments/${c.id}`); loadComments(); };
  const delUser = async (u) => { await api.del(`/admin/users/${u.id}`); loadUsers(); };
  const saveColor = async (u, field, value) => { await api.put(`/admin/users/${u.id}`, { [field]: value }); loadUsers(); };
  return (
    <div className="admin-card">
      <div className="admin-panel-head">
        <div className="grad-tabs">
          <button className={`grad-tab ${view === "users" ? "active" : ""}`} onClick={() => setView("users")}>注册用户</button>
          <button className={`grad-tab ${view === "comments" ? "active" : ""}`} onClick={() => setView("comments")}>评论审核</button>
          <button className={`grad-tab ${view === "submissions" ? "active" : ""}`} onClick={() => setView("submissions")}>投稿审核</button>
        </div>
      </div>
      {view === "users" && <AdminTable columns={[
        { key: "username", label: "用户名" },
        { key: "nickname", label: "昵称" },
        { key: "role", label: "角色", render: (r) => <span className="admin-badge red">{r.role}</span> },
        { key: "color", label: "昵称/角色色", render: (r) => <span className="gradient-pickers"><input type="color" value={r.nickname_color || "#4f6ef7"} onChange={(e) => saveColor(r, "nickname_color", e.target.value)} /><input type="color" value={r.role_color || "#ef4444"} onChange={(e) => saveColor(r, "role_color", e.target.value)} /></span> },
        { key: "action", label: "操作", render: (r) => <button className="mini-btn red" onClick={() => delUser(r)}>删除</button> }
      ]} rows={users} />}
      {view === "comments" && <AdminTable columns={[
        { key: "user", label: "用户" },
        { key: "linkTitle", label: "卡片", render: (r) => <Link className="mini-btn green" to={`/sites/${r.linkId}`}>{r.linkTitle}</Link> },
        { key: "content", label: "评论内容", size: "2fr" },
        { key: "action", label: "操作", render: (r) => <button className="mini-btn red" onClick={() => delComment(r)}>删除</button> }
      ]} rows={comments} />}
      {view === "submissions" && <AdminTable columns={[
        { key: "title", label: "标题" },
        { key: "url", label: "URL", size: "2fr" },
        { key: "status", label: "状态" },
        { key: "action", label: "操作", size: "200px", render: (r) => <span className="row-actions"><button className="mini-btn green" onClick={() => approve(r)}>通过</button><button className="mini-btn" onClick={() => reject(r)}>拒绝</button><button className="mini-btn red" onClick={() => delSub(r)}>删除</button></span> }
      ]} rows={subs} />}
    </div>
  );
}

function PopupAdmin({ sync }) {
  const [settings, setSettings] = useState(null);
  useEffect(() => { api.get("/admin/settings").then(setSettings).catch(() => {}); }, []);
  if (!settings) return <div className="admin-card"><AdminHeader title="弹窗公告" /><p className="muted">加载中…</p></div>;
  const save = async () => { await api.put("/admin/settings", { popupEnabled: settings.popupEnabled, noticeTitle: settings.noticeTitle, noticeText: settings.noticeText, noticeImage: settings.noticeImage }); sync(); };
  return (
    <div className="admin-card">
      <AdminHeader title="弹窗公告"><button className="primary-btn" onClick={save}>保存公告</button></AdminHeader>
      <label className="check-line"><input type="checkbox" checked={settings.popupEnabled} onChange={(e) => setSettings({ ...settings, popupEnabled: e.target.checked })} />启用弹窗公告</label>
      <div className="admin-grid">
        <div className="field"><label>标题</label><input value={settings.noticeTitle || ""} onChange={(e) => setSettings({ ...settings, noticeTitle: e.target.value })} /></div>
        <div className="field"><label>图片</label><input value={settings.noticeImage || ""} onChange={(e) => setSettings({ ...settings, noticeImage: e.target.value })} /></div>
        <div className="field full"><label>内容</label><textarea value={settings.noticeText || ""} onChange={(e) => setSettings({ ...settings, noticeText: e.target.value })} /></div>
      </div>
    </div>
  );
}

function SettingsPanel({ sync }) {
  const [settings, setSettings] = useState(null);
  useEffect(() => { api.get("/admin/settings").then(setSettings).catch(() => {}); }, []);
  if (!settings) return <div className="admin-card"><AdminHeader title="网站设置" /><p className="muted">加载中…</p></div>;
  const set = (k, v) => setSettings({ ...settings, [k]: v });
  const save = async () => {
    await api.put("/admin/settings", {
      title: settings.title, subtitle: settings.subtitle, logoText: settings.logoText,
      searchPlaceholder: settings.searchPlaceholder, footer: settings.footer
    });
    sync();
  };
  return (
    <div className="admin-card">
      <AdminHeader title="网站设置"><button className="primary-btn" onClick={save}>保存设置</button></AdminHeader>
      <div className="admin-grid">
        <div className="field"><label>站点标题</label><input value={settings.title || ""} onChange={(e) => set("title", e.target.value)} /></div>
        <div className="field"><label>副标题</label><input value={settings.subtitle || ""} onChange={(e) => set("subtitle", e.target.value)} /></div>
        <div className="field"><label>Logo 文本</label><input value={settings.logoText || ""} onChange={(e) => set("logoText", e.target.value)} /></div>
        <div className="field"><label>搜索占位</label><input value={settings.searchPlaceholder || ""} onChange={(e) => set("searchPlaceholder", e.target.value)} /></div>
        <div className="field"><label>页脚</label><input value={settings.footer || ""} onChange={(e) => set("footer", e.target.value)} /></div>
      </div>
    </div>
  );
}

function BottomNav({ hidden }) {
  const location = useLocation();
  const items = [
    { to: "/", label: "首页", icon: HomeIcon },
    { to: "/submit", label: "投稿", icon: Send },
    { to: "/me", label: "我的", icon: User }
  ];
  return (
    <nav className={`bottom-nav ${hidden ? "hidden" : ""}`}>
      {items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={`bn-item ${location.pathname === to ? "active" : ""}`}><span className="bn-ico"><Icon /></span>{label}</NavLink>)}
    </nav>
  );
}

function NotFound() {
  return <main className="form-page"><div className="form-card"><h1>未找到页面</h1><Link className="primary-btn" to="/">返回首页</Link></div></main>;
}

export default App;
