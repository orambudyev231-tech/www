import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  BarChart3, Bell, BookOpen, Check, ChevronRight, FileText, FolderTree, Home as HomeIcon,
  Image as ImageIcon, LayoutDashboard, Lock, LogIn, Megaphone, Menu, MessageSquare,
  Monitor, Navigation, Palette, Pencil, Plus, RefreshCw, Search, Send, Settings, Shield, Sparkles, Tags,
  Trash2, Type, User, Users, X
} from "lucide-react";
import { api, getToken, setToken } from "./api";

const iconSrc = (link) => {
  const icon = link.icon || "";
  const domain = link.domain || "";
  if (icon && !/\/s2\/favicons/i.test(icon)) return icon;
  return `/api/public/favicon?domain=${encodeURIComponent(domain)}`;
};

const externalUrl = (url) => {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^(https?:|tg:|mailto:|tel:)/i.test(value)) return value;
  return `https://${value}`;
};

const EMPTY = { settings: {}, categories: [], links: [], ads: [], banners: [], notices: [], navs: [] };
const IDLE_LIMIT = 10 * 60 * 1000;
const LAST_ACTIVE_KEY = "nav_last_active";

const markActive = () => localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
const clearLogin = () => {
  setToken(null);
  localStorage.removeItem(LAST_ACTIVE_KEY);
};

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
        : <span className="cmt-captcha-img" onClick={cap.refresh}>...</span>}
    </label>
  );
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

/* ============ App 根 ============ */
function App() {
  const [data, setData] = useState(EMPTY);
  const [user, setUser] = useState(null);
  const [hideNav, setHideNav] = useState(false);
  const location = useLocation();
  const rawFrontTheme = data.settings?.frontTheme || "current";
  const frontTheme = ["current", "clean", "portal", "pro", "fresh"].includes(rawFrontTheme) ? rawFrontTheme : "current";

  const refreshData = useCallback(async () => {
    try { setData(await api.get("/public/data")); } catch { /* ignore */ }
  }, []);

  // 初始加载 + 恢复登录态
  useEffect(() => {
    refreshData();
    if (getToken()) {
      const last = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
      if (last && Date.now() - last > IDLE_LIMIT) {
        clearLogin();
        return;
      }
      if (!last) markActive();
      api.get("/auth/me").then((r) => setUser(r.user)).catch(clearLogin);
    }
  }, [refreshData]);

  useEffect(() => {
    api.post("/public/visit", { path: `${location.pathname}${location.search}` }).catch(() => {});
  }, [location.pathname, location.search]);

  // 同步浏览器标签标题为后台设置的网站名称
  useEffect(() => {
    if (data.settings?.title) document.title = data.settings.title;
  }, [data.settings]);

  // 应用全局颜色变量
  useEffect(() => {
    if (!data.settings || !data.settings.colors) return;
    try {
      const colors = JSON.parse(data.settings.colors);
      Object.entries(colors).forEach(([k, v]) => v && document.documentElement.style.setProperty(k, v));
    } catch { /* ignore */ }
  }, [data.settings]);

  useEffect(() => {
    const s = data.settings || {};
    const root = document.documentElement;
    root.style.setProperty("--site-font-family", s.fontFamily || '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif');
    root.style.setProperty("--site-title-weight", s.titleWeight || "800");
    root.style.setProperty("--site-body-size", `${Number(s.bodyFontSize) || 14}px`);
    root.style.setProperty("--site-card-title-size", `${Number(s.cardTitleSize) || 14}px`);
    root.style.setProperty("--site-marquee-size", `${Number(s.marqueeFontSize) || 14}px`);
  }, [data.settings]);

  // SSE 实时刷新 + 20 秒轮询兜底
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("update", refreshData);
    const poll = setInterval(refreshData, 20000);
    return () => { es.close(); clearInterval(poll); };
  }, [refreshData]);

  // 滚动中隐藏底部导航，停止后显示
  useEffect(() => {
    let showTimer = 0;
    const onScroll = () => {
      if (window.scrollY > 20) setHideNav(true);
      window.clearTimeout(showTimer);
      showTimer = window.setTimeout(() => setHideNav(false), 450);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(showTimer);
    };
  }, []);

  // 全站 10 分钟无操作自动退出（所有登录账号，电脑端/移动端）
  useEffect(() => {
    if (!user) return;
    const logoutIdle = () => { clearLogin(); setUser(null); };
    const check = () => {
      const last = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
      if (!last) return markActive();
      if (Date.now() - last > IDLE_LIMIT) logoutIdle();
    };
    const touch = () => {
      const last = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
      if (last && Date.now() - last > IDLE_LIMIT) return logoutIdle();
      markActive();
    };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart", "touchmove", "pointerdown"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, 30000);
    markActive();
    check();
    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, touch));
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user]);

  const logout = () => { clearLogin(); setUser(null); };

  return (
    <div className="app-shell" data-front-theme={frontTheme}>
      <Routes>
        <Route path="/" element={<Home data={data} user={user} refreshData={refreshData} />} />
        <Route path="/sites/:id" element={<SiteDetail data={data} user={user} />} />
        <Route path="/login" element={<Login setUser={setUser} />} />
        <Route path="/submit" element={<Submit data={data} user={user} />} />
        <Route path="/me" element={<Me user={user} logout={logout} data={data} />} />
        <Route path="/admin/*" element={<Admin user={user} data={data} refreshData={refreshData} logout={logout} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <BottomNav hidden={hideNav} user={user} />
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
          {user?.role === "admin" && <Link className="admin-btn" to="/admin"><Shield size={15} />管理后台</Link>}
          {user && <Link className="header-submit-link" to="/submit">投稿</Link>}
          {user ? <Link className="ghost-btn" to="/me"><User size={15} />{user.nickname || user.username}</Link> : <Link className="ghost-btn" to="/login"><LogIn size={15} />注册登录</Link>}
        </div>
      </div>
    </header>
  );
}

/* ============ 首页 ============ */
function Home({ data, user, refreshData }) {
  const [activeCat, setActiveCat] = useState("");
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [popup, setPopup] = useState(null);
  const [adPopup, setAdPopup] = useState(null);
  const [frontEdit, setFrontEdit] = useState(null);
  const [frontSelectKind, setFrontSelectKind] = useState("");
  const [frontSelected, setFrontSelected] = useState(null);
  const [frontMenu, setFrontMenu] = useState(false);
  const s = data.settings || {};
  const [notice, setNotice] = useState(false);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    sessionStorage.removeItem("notice-ok");
    if (s.popupEnabled && s.noticeTitle) setNotice(true);
  }, [s.popupEnabled, s.noticeTitle]);

  const q = search.trim().toLowerCase();
  const match = (link) => !q || [link.title, link.desc, link.sub].join(" ").toLowerCase().includes(q);
  const visibleCats = data.categories.filter((cat) => (isAdmin && !q) || !q || data.links.some((l) => l.cat === cat.id && match(l)));

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
          {user?.role === "admin" && <Link className="admin-btn drawer-admin-btn" to="/admin"><Shield size={15} />管理后台</Link>}
        </aside>
        <main className="main-col">
          <NavBar navs={data.navs} />
          {data.banners.length > 0 && <Banner banners={data.banners} />}
          {data.settings?.marqueeEnabled !== "0" && data.notices.length > 0 && <Marquee notices={data.notices} settings={data.settings} />}
          {data.ads.length > 0 && <Ads ads={data.ads} onOpen={setAdPopup} editMode={frontSelectKind === "ad"} selectedId={frontSelected?.kind === "ad" ? frontSelected.item.id : ""} onSelect={(ad) => setFrontSelected({ kind: "ad", item: ad })} onEdit={(ad) => setFrontEdit({ kind: "ad", item: ad })} />}
          {visibleCats.map((cat) => {
            const links = data.links.filter((l) => l.cat === cat.id && match(l));
            if (!links.length && !isAdmin) return null;
            return <CategorySection key={cat.id} cat={cat} links={links} onOpen={setPopup} editMode={frontSelectKind === "link"} selectedId={frontSelected?.kind === "link" ? frontSelected.item.id : ""} onSelect={(link) => setFrontSelected({ kind: "link", item: link })} onEdit={(link) => setFrontEdit({ kind: "link", item: link })} />;
          })}
        </main>
      </div>
      {isAdmin && (
        <div className="front-global-admin">
          {frontMenu && (
            <div className="front-global-menu">
              <button onClick={() => { setFrontMenu(false); setFrontEdit({ kind: "link", item: null, catId: data.categories[0]?.id || "" }); }}>新增卡片</button>
              <button onClick={() => { setFrontMenu(false); setFrontSelected(null); setFrontSelectKind("link"); }}>编辑卡片</button>
              <button onClick={() => { setFrontMenu(false); setFrontEdit({ kind: "ad", item: null }); }}>新增广告</button>
              <button onClick={() => { setFrontMenu(false); setFrontSelected(null); setFrontSelectKind("ad"); }}>编辑广告</button>
            </div>
          )}
          <button
            className={`front-global-btn ${frontSelectKind ? "active" : ""}`}
            title={frontSelectKind ? "取消编辑" : "前台编辑"}
            onClick={() => {
              if (frontSelectKind) {
                setFrontSelectKind("");
                setFrontSelected(null);
                setFrontEdit(null);
                setFrontMenu(false);
                return;
              }
              setFrontMenu((v) => !v);
            }}
          >
            <Pencil size={18} />
          </button>
        </div>
      )}
      {frontEdit && <FrontAdminModal data={data} modal={frontEdit} onClose={() => setFrontEdit(null)} onSaved={() => { setFrontEdit(null); refreshData?.(); }} />}
      {popup && <LinkPopup link={popup} onClose={() => setPopup(null)} />}
      {adPopup && <AdPopup ad={adPopup} onClose={() => setAdPopup(null)} />}
      {notice && (
        <div className="notice-bg">
          <div className="notice-card">
            <button className="popup-close" style={{ position: "absolute", top: 12, right: 12 }} onClick={() => setNotice(false)}><X size={15} /></button>
            <h2>{s.noticeTitle}</h2>
            {s.noticeImage && <img src={s.noticeImage} alt="公告图片" />}
            <p>{s.noticeText}</p>
            <div className="notice-foot">
              <button className="ghost-btn" onClick={() => {
                const url = externalUrl(s.noticeTgUrl);
                if (url) window.open(url, "_blank", "noopener,noreferrer");
                setNotice(false);
              }}><Send size={15} />{s.noticeTgText || "TG联系"}</button>
              <button className="primary-btn" onClick={() => setNotice(false)}><Check size={15} />知道了</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NavBar({ navs }) {
  if (!navs.length) return null;
  return <div className="nav-bar">{navs.map((n, i) => <a key={`${n}-${i}`} href="#top">{n}</a>)}</div>;
}

function Banner({ banners }) {
  return (
    <div className="banner-stack">
      {banners.map((src, i) => <div className="banner-wrap" key={`${src}-${i}`}><img className="banner-img" src={src} alt="导航站横幅" /></div>)}
    </div>
  );
}

function Marquee({ notices, settings = {} }) {
  const items = [...notices, ...notices];
  const speed = Number(settings.marqueeSpeed) || 30;
  const gradientOn = settings.marqueeGradient !== "0";
  const gradColors = [settings.marqueeGrad1 || "#ff6673", settings.marqueeGrad2 || "#4f6ef7", settings.marqueeGrad3 || "#22c55e"];
  return (
    <div className="marquee marquee-neon">
      <div className="marquee-viewport">
        <div className="marquee-track" style={{ animationDuration: `${speed}s` }}>
          {items.map((item, i) => {
            const notice = typeof item === "string" ? { text: item } : item;
            const style = gradientOn
              ? { "--grad": neonMarqueeGradient(gradColors) }
              : { color: notice.color || "#fff" };
            const cls = `marquee-item ${gradientOn ? "marquee-grad" : ""}`;
            const content = notice.text;
            return notice.url
              ? <a className={cls} href={externalUrl(notice.url)} target="_blank" rel="noreferrer" style={style} key={`${notice.text}-${i}`}>{content}</a>
              : <span className={cls} style={style} key={`${notice.text}-${i}`}>{content}</span>;
          })}
        </div>
      </div>
    </div>
  );
}

function gradStyle(arr) {
  if (!arr || !arr.length) return undefined;
  const stops = arr.length === 1 ? [arr[0], arr[0], arr[0]] : arr;
  const loopStops = [...stops, stops[0]];
  return {
    background: `linear-gradient(90deg, ${loopStops.join(", ")})`,
    backgroundSize: "240% 100%",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
    color: "transparent"
  };
}

function neonMarqueeGradient(colors) {
  const [a, b, c] = colors;
  return `linear-gradient(90deg, ${a} 0%, ${b} 35%, ${c} 70%, ${a} 100%)`;
}

function Ads({ ads, onOpen, editMode = false, selectedId = "", onSelect, onEdit }) {
  const circleClass = ads.length >= 5 ? "ad-c5" : "ad-c4";
  const handleAdClick = (e, ad) => {
    if (editMode) {
      e.preventDefault();
      onSelect?.(ad);
      return;
    }
    if (!ad.subs?.length || !onOpen) return;
    e.preventDefault();
    onOpen(ad);
  };
  return (
    <section className="ads-wrap">
      <div className="ads-header">
        <div className="ads-header-left"><span className="ads-dot" /><span className="ads-title">推荐广告</span></div>
      </div>
      <div className={`ads-row ad-circle ${circleClass}`}>
        {ads.map((ad) => (
          <a className={`ad-card ${editMode ? "front-selectable" : ""} ${editMode && selectedId === ad.id ? "front-selected" : ""}`} href={externalUrl(ad.url)} target="_blank" rel="noreferrer" key={ad.id} onClick={(e) => handleAdClick(e, ad)}>
            {editMode && selectedId === ad.id && <span className="front-selected-edit" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit?.(ad); }}>编辑</span>}
            <span className="ad-ic"><img src={iconSrc(ad)} alt="" /></span>
            <span className="ad-tx">
              <div className="ad-title" style={ad.titleColor ? { color: ad.titleColor } : undefined}>{ad.title}</div>
              <div className="ad-desc grad-text" style={gradStyle(ad.descGradient) || (ad.descColor ? { color: ad.descColor } : undefined)}>{ad.desc}</div>
            </span>
            {ad.badge && <span className="ad-badge" style={ad.badgeColor ? { background: ad.badgeColor } : undefined}>{ad.badge}</span>}
          </a>
        ))}
      </div>
    </section>
  );
}

function CategorySection({ cat, links, onOpen, editMode = false, selectedId = "", onSelect, onEdit }) {
  const [activeSub, setActiveSub] = useState("");
  const [expanded, setExpanded] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const shown = activeSub ? links.filter((l) => l.sub === activeSub) : links;
  const limit = isMobile ? 10 : 20;
  const visibleLinks = expanded ? shown : shown.slice(0, limit);
  const hasMore = shown.length > limit;
  useEffect(() => { setExpanded(false); }, [activeSub, cat.id]);
  return (
    <section className="section-card fade-in" id={`cat-${cat.id}`}>
      <div className="section-head">
        <div className="section-title"><BookOpen size={18} color="var(--primary)" /><h2>{cat.name}</h2></div>
        <div className="section-tools">
          <div className="sub-tabs">
            {cat.subs.length > 0 && <span className={`sub-tab ${activeSub === "" ? "active" : ""}`} onClick={() => setActiveSub("")}>全部</span>}
            {cat.subs.map((sub) => (
              <span className={`sub-tab ${activeSub === sub ? "active" : ""}`} key={sub} onClick={() => setActiveSub(sub)}>
                {sub}
              </span>
            ))}
          </div>
          {hasMore && <button className="section-more-btn" onClick={() => setExpanded((v) => !v)}>{expanded ? "收起" : "更多"}</button>}
        </div>
      </div>
      <div className="link-grid">
        {visibleLinks.map((link) => (
          <button className={`link-card ${editMode ? "front-selectable" : ""} ${editMode && selectedId === link.id ? "front-selected" : ""}`} key={link.id} onClick={() => editMode ? onSelect?.(link) : onOpen(link)}>
            {editMode && selectedId === link.id && <span className="front-selected-edit" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit?.(link); }}>编辑</span>}
            <LinkCardContent link={link} />
          </button>
        ))}
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
        <span className={`link-desc${link.descGradient?.length ? " grad-text" : ""}`} style={gradStyle(link.descGradient) || { color: link.descColor || "#000" }}>{link.desc}</span>
      </span>
    </>
  );
}

function SubLinksEditor({ subs = [], draft = { title: "", url: "" }, onDraft, onAdd, onRemove, hint = "" }) {
  return (
    <div className="field full">
      <label className="sublink-label">子链接<span className="sublink-count">({subs.length} 条)</span></label>
      {subs.length > 0 && (
        <div className="sublink-list">
          {subs.map((s, i) => (
            <div className="sublink-item" key={`${s.url || s.title}-${i}`}>
              <span className="sublink-item-title">{s.title}</span>
              <span className="sublink-item-url">{s.url}</span>
              <button className="sublink-del" onClick={() => onRemove(i)} aria-label="删除子链接"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="sublink-add-row">
        <input className="sublink-title-input" placeholder="标题 *" value={draft.title} onChange={(e) => onDraft("title", e.target.value)} />
        <input className="sublink-url-input" placeholder="URL (https://...) *" value={draft.url} onChange={(e) => onDraft("url", e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onAdd())} />
        <button className="primary-btn sublink-add-btn" onClick={onAdd}><Plus size={15} />添加</button>
      </div>
      {hint && <div className="sublink-hint">{hint}</div>}
    </div>
  );
}

function FrontAdminModal({ data, modal, onClose, onSaved }) {
  const isLink = modal.kind === "link";
  const item = modal.item;
  const initialCat = modal.catId || item?.cat || data.categories[0]?.id || "";
  const [draft, setDraft] = useState(() => ({
    id: item?.id,
    title: item?.title || "",
    url: item?.url || "",
    desc: item?.desc || "",
    badge: item?.badge || (isLink ? "" : "AD"),
    cat: initialCat,
    sub: modal.sub || item?.sub || "",
    subs: (item?.subs || []).map((s) => ({ title: s.title, url: s.url })),
    subDraft: { title: "", url: "" },
    icon: item?.icon || "",
    iconFile: null,
    iconPreview: ""
  }));
  const [error, setError] = useState("");
  const titleRef = useRef(null);
  const currentCat = data.categories.find((c) => c.id === draft.cat);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const updateSubDraft = (k, v) => setDraft((d) => ({ ...d, subDraft: { ...d.subDraft, [k]: v } }));
  const addSub = () => setDraft((d) => {
    const sub = d.subDraft || { title: "", url: "" };
    if (!sub.title.trim() || !sub.url.trim()) return d;
    return {
      ...d,
      subs: [...(d.subs || []), { title: sub.title.trim(), url: sub.url.trim() }],
      subDraft: { title: "", url: "" }
    };
  });
  const removeSub = (i) => setDraft((d) => ({ ...d, subs: (d.subs || []).filter((_, index) => index !== i) }));
  const pickIcon = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDraft((d) => ({ ...d, iconFile: file, iconPreview: reader.result }));
    reader.readAsDataURL(file);
  };
  const save = async () => {
    if (!draft.title.trim()) {
      setError("请填写标题");
      titleRef.current?.focus();
      return;
    }
    if (!draft.url.trim()) {
      setError("请填写链接");
      return;
    }
    setError("");
    let id = draft.id;
    if (isLink) {
      const body = { title: draft.title.trim(), url: draft.url.trim(), cat: draft.cat, sub: draft.sub, badge: draft.badge.trim(), desc: draft.desc.trim() };
      if (id) await api.put(`/admin/links/${id}`, body);
      else {
        const r = await api.post("/admin/links", body);
        id = r.id;
      }
      await api.put(`/admin/links/${id}/subs`, { subs: (draft.subs || []).filter((s) => s.title && s.url) });
    } else {
      const body = { title: draft.title.trim(), url: draft.url.trim(), badge: draft.badge.trim(), desc: draft.desc.trim() };
      if (id) await api.put(`/admin/ads/${id}`, body);
      else {
        const r = await api.post("/admin/ads", body);
        id = r.id;
      }
      await api.put(`/admin/ads/${id}/subs`, { subs: (draft.subs || []).filter((s) => s.title && s.url) });
    }
    if (draft.iconFile) {
      const form = new FormData();
      form.append("icon", draft.iconFile);
      form.append(isLink ? "linkId" : "adId", id);
      await api.upload("/admin/upload-icon", form);
    }
    onSaved?.();
  };

  return (
    <div className="edit-overlay" onClick={onClose}>
      <div className="edit-modal front-admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-panel-head">
          <h1>{draft.id ? `编辑${isLink ? "卡片" : "广告"}` : `新增${isLink ? "卡片" : "广告"}`}</h1>
          <button className="popup-close" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="admin-grid modal-grid2">
          <div className="field"><label>标题</label><input ref={titleRef} autoFocus value={draft.title} onChange={(e) => set("title", e.target.value)} /></div>
          <div className="field"><label>链接</label><input value={draft.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" /></div>
          {isLink && (
            <>
              <div className="field"><label>分类</label><select value={draft.cat} onChange={(e) => setDraft((d) => ({ ...d, cat: e.target.value, sub: "" }))}>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div className="field"><label>子分类</label><select value={draft.sub || ""} onChange={(e) => set("sub", e.target.value)}><option value="">（无）</option>{(currentCat?.subs || []).map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            </>
          )}
          <SubLinksEditor subs={draft.subs || []} draft={draft.subDraft} onDraft={updateSubDraft} onAdd={addSub} onRemove={removeSub} />
          <div className="field"><label>角标</label><input value={draft.badge} onChange={(e) => set("badge", e.target.value)} placeholder={isLink ? "HOT / NEW" : "AD"} /></div>
          <div className="field full"><label>描述</label><input value={draft.desc} onChange={(e) => set("desc", e.target.value)} /></div>
          <div className="field full">
            <label>图标</label>
            <div className="icon-row">
              <span className="icon-preview"><img src={draft.iconPreview || iconSrc({ icon: draft.icon, domain: (draft.url || "").replace(/^https?:\/\//, "").split("/")[0] })} alt="" /></span>
              <label className="ghost-btn">上传图标<input type="file" accept="image/*" hidden onChange={(e) => pickIcon(e.target.files[0])} /></label>
              {draft.iconFile && <span className="muted">已选择：{draft.iconFile.name}</span>}
            </div>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="edit-foot">
          <span style={{ flex: 1 }} />
          <button className="ghost-btn" onClick={onClose}>取消</button>
          <button className="primary-btn" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}

function LinkPopup({ link, onClose }) {
  const open = (url) => {
    api.get(`/public/link/${link.id}`).catch(() => {}); // 娴忚 +1
    window.open(externalUrl(url), "_blank", "noopener,noreferrer");
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
function AdPopup({ ad, onClose }) {
  const open = (url) => {
    window.open(externalUrl(url), "_blank", "noopener,noreferrer");
  };
  return (
    <div className="popup-bg" onClick={onClose}>
      <div className="popup" onClick={(e) => e.stopPropagation()}>
        <div className="popup-header">
          <strong>{ad.title}</strong>
          <button className="popup-close" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="popup-links">
          <button className="popup-item" onClick={() => open(ad.url)}>
            <span className="popup-tag">主站</span>
            <span className="popup-item-text"><span className="popup-item-title">{ad.title}</span><span className="popup-item-url">{ad.url}</span></span>
          </button>
          {(ad.subs || []).map((sub) => (
            <button className="popup-item" key={sub.url} onClick={() => open(sub.url)}>
              <span className="popup-tag">子链</span>
              <span className="popup-item-text"><span className="popup-item-title">{sub.title}</span><span className="popup-item-url">{sub.url}</span></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SiteDetail({ data, user }) {
  const { id } = useParams();
  const [link, setLink] = useState(null);
  const [cat, setCat] = useState(null);
  const [adPopup, setAdPopup] = useState(null);
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
  }, [id, loadComments]);

  if (notFound) return <NotFound />;
  if (!link) return <main className="form-page"><div className="form-card"><h1>加载中...</h1></div></main>;

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
        {data.banners.length > 0 && <Banner banners={data.banners} />}
        {data.settings?.marqueeEnabled !== "0" && data.notices.length > 0 && <Marquee notices={data.notices} settings={data.settings} />}
        {data.ads.length > 0 && <Ads ads={data.ads} onOpen={setAdPopup} />}
        <section className="detail-card">
          <div className="detail-title-row">
            <img className="detail-icon" src={iconSrc(link)} alt="" />
            <h1 className="detail-h1">{link.title}</h1>
            <span className="detail-tag">{cat?.name}</span>
            <a className="detail-open-btn" href={externalUrl(link.url)} target="_blank" rel="noreferrer">打开网站</a>
            <div className="detail-sub-wrap">{link.subs.map((sub) => (
              <a className="detail-sub-link" href={externalUrl(sub.url)} target="_blank" rel="noreferrer" key={sub.url}>
                <span className="detail-sub-title">{sub.title}</span>
                <span className="detail-sub-url">{sub.url}</span>
              </a>
            ))}</div>
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
            {image && <div style={{ marginTop: 8 }}><img src={image} alt="棰勮" style={{ maxWidth: 120, borderRadius: 8 }} /> <button className="ghost-btn" onClick={() => setImage("")}>绉婚櫎</button></div>}
            <div className="cmt-tool-row">
              <label className="cmt-img-btn">{uploading ? "上传中" : "图片"}<input type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files[0])} /></label>
              <CaptchaBox cap={cap} />
              <button className="cmt-submit-btn" onClick={postComment}>发表评论</button>
            </div>
            {error && <div className="error">{error}</div>}
          </div>
        </section>
      </main>
      {adPopup && <AdPopup ad={adPopup} onClose={() => setAdPopup(null)} />}
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
      markActive();
      setUser(r.user);
      navigate("/", { replace: true });
    } catch (e) { setError(e.message); cap.reset(); }
  };

  return (
    <main className="form-page login-page">
      <div className="form-card login-card">
        <div className="login-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>会员登入</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }}>注册账号</button>
        </div>
        <div className="login-field">
          <User size={20} />
          <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="账号" />
        </div>
        {mode === "register" && (
          <div className="login-field">
            <User size={20} />
            <input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="昵称" />
          </div>
        )}
        <div className="login-field">
          <Lock size={20} />
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="密码" />
        </div>
        <div className="login-captcha-row">
          <input value={cap.input} onChange={(e) => cap.setInput(e.target.value)} placeholder="验证码" />
          {cap.image ? <img className="login-captcha-img" src={cap.image} alt="验证码" onClick={cap.refresh} /> : <button className="login-captcha-img" onClick={cap.refresh}>...</button>}
        </div>
        <button className="login-submit" onClick={submit}>{mode === "login" ? "登录" : "注册"}</button>
        <div className="login-options">
          <label><input type="checkbox" /> 储存账号</label>
          <button type="button">忘记密码?</button>
        </div>
        {error && <div className="error">{error}</div>}
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
            <Link className="primary-btn" to="/submit" style={{ width: "100%", justifyContent: "center", marginTop: 14 }}><Send size={15} />发布投稿</Link>
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
  const isOwnerAdmin = user?.adminLevel === "owner";

  useEffect(() => { localStorage.setItem("admin-ad-style", adStyle); }, [adStyle]);

  const allTabs = [
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
    ["themes", "主题管理", Monitor],
    ["fonts", "字体管理", Type],
    ["stats", "访客统计", BarChart3],
    ["users", "用户管理", Users],
    ["popup", "弹窗公告", MessageSquare],
    ["settings", "网站设置", Settings]
  ];
  const ownerOnlyTabs = new Set(["colors", "gradients", "themes", "fonts", "users", "popup", "settings"]);
  const tabs = isOwnerAdmin ? allTabs : allTabs.filter(([id]) => !ownerOnlyTabs.has(id));
  const currentTitle = tabs.find(([id]) => id === tab)?.[1] || "管理后台";

  useEffect(() => {
    if (!tabs.some(([id]) => id === tab)) setTab("links");
  }, [tab, tabs]);

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
    <div className={`admin-wrap ${isOwnerAdmin ? "owner-admin" : "limited-admin"}`}>
      {drawer && <div className="admin-overlay" onClick={() => setDrawer(false)} />}
      <aside className={`admin-sidebar ${drawer ? "open" : ""}`}>
        <div className="admin-side-top">
          <span className="admin-brand-icon">导</span>
          <span><strong>导航后台</strong><small>{user.nickname || user.username} - 管理员</small></span>
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
          {tab === "themes" && <ThemesAdmin data={data} sync={refreshData} />}
          {tab === "fonts" && <FontsAdmin sync={refreshData} />}
          {tab === "stats" && <StatsAdmin />}
          {tab === "users" && <UsersAdmin data={data} sync={refreshData} user={user} />}
          {tab === "popup" && <PopupAdmin sync={refreshData} />}
          {tab === "settings" && <SettingsPanel sync={refreshData} user={user} />}
        </section>
      </main>
    </div>
  );
}

function AdminHeader({ title, children }) {
  return <div className="admin-panel-head"><h1>{title}</h1><div className="admin-actions">{children}</div></div>;
}

function AdminTable({ columns, rows, minWidth = 760, className = "" }) {
  const cols = columns.map((c) => c.size || "1fr").join(" ");
  return (
    <div className="admin-table-wrap">
      <div className={`admin-table ${className}`} style={{ minWidth }}>
        <div className="admin-table-row head" style={{ "--cols": cols }}>
          {columns.map((c) => <span className={`col-${c.key}`} key={c.key}>{c.label}</span>)}
        </div>
        {rows.length ? rows.map((row) => (
          <div className="admin-table-row" style={{ "--cols": cols }} key={row.id}>
            {columns.map((c) => <span className={`col-${c.key}`} key={c.key}>{c.render ? c.render(row) : row[c.key]}</span>)}
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
    // 子链整体替换
    await api.put(`/admin/links/${id}/subs`, { subs: (modal.subs || []).filter((s) => s.title && s.url) });
    // 本地图标上传：保存为 up_ 前缀，重新抓图标时不覆盖
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
      <div className="admin-filter-bar links-filter-bar">
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
              <SubLinksEditor subs={modal.subs || []} draft={modal.subDraft} onDraft={updateSubDraft} onAdd={addSub} onRemove={removeSub} hint="提示：子链接会在保存主链接后一起创建" />
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
        <input ref={nameRef} className="head-input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="输入分类名称..." />
        <button className="primary-btn" onClick={add}><Plus size={15} />新增分类</button>
      </AdminHeader>
      <AdminTable className="categories-admin-table" columns={[
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
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState({ cat: "", name: "" });
  const nameRef = useRef(null);
  useEffect(() => { if (!draft.cat && cats[0]) setDraft((d) => ({ ...d, cat: cats[0].id })); }, [cats, draft.cat]);
  const reload = () => { load(); sync(); };
  const rows = cats.flatMap((c) => (c.subItems || c.subs.map((name) => ({ id: `${c.id}-${name}`, name }))).map((sub) => ({ id: sub.id, catId: c.id, catName: c.name, name: sub.name })));
  const add = async () => { if (!draft.cat || !draft.name.trim()) { nameRef.current?.focus(); return; } await api.post("/admin/sub-categories", { cat: draft.cat, name: draft.name.trim() }); setDraft({ ...draft, name: "" }); reload(); };
  const startEdit = (r) => { setEditId(r.id); setEditDraft({ cat: r.catId, name: r.name }); };
  const cancelEdit = () => { setEditId(null); setEditDraft({ cat: "", name: "" }); };
  const saveEdit = async () => {
    if (!editDraft.name.trim()) return;
    await api.put(`/admin/sub-categories/${editId}`, { cat: editDraft.cat, name: editDraft.name.trim() });
    cancelEdit();
    reload();
  };
  const remove = async (id) => { await api.del(`/admin/sub-categories/${id}`); reload(); };
  return (
    <div className="admin-card">
      <AdminHeader title="子分类管理">
        <select className="head-select" value={draft.cat} onChange={(e) => setDraft({ ...draft, cat: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input ref={nameRef} className="head-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="输入子分类名称..." />
        <button className="primary-btn" onClick={add}><Plus size={15} />新增子分类</button>
      </AdminHeader>
      <AdminTable columns={[
        { key: "catName", label: "所属分类", render: (r) => editId === r.id
          ? <select className="inline-edit-input" value={editDraft.cat} onChange={(e) => setEditDraft({ ...editDraft, cat: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          : r.catName },
        { key: "name", label: "子分类", render: (r) => editId === r.id
          ? <input className="inline-edit-input" value={editDraft.name} autoFocus onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }} />
          : r.name },
        { key: "count", label: "链接数", render: (r) => data.links.filter((l) => l.cat === r.catId && l.sub === r.name).length },
        { key: "action", label: "操作", render: (r) => editId === r.id
          ? <span className="row-actions"><button className="mini-btn green" onClick={saveEdit}>保存</button><button className="mini-btn" onClick={cancelEdit}>取消</button></span>
          : <span className="row-actions"><button className="mini-btn green" onClick={() => startEdit(r)}>编辑</button><button className="mini-btn red" onClick={() => remove(r.id)}>删除</button></span> }
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
  const emptyDraft = { title: "", url: "", desc: "", badge: "AD", subs: [], subDraft: { title: "", url: "" }, icon: "", iconFile: null, iconPreview: "" };
  const [draft, setDraft] = useState(emptyDraft);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef(null);
  const urlRef = useRef(null);
  const reload = () => { load(); sync(); };
  const openAdd = () => {
    setDraft(emptyDraft);
    setError("");
    setOpen(true);
  };
  const openEdit = (r) => {
    setDraft({ ...r, subs: (r.subs || []).map((s) => ({ title: s.title, url: s.url })), subDraft: { title: "", url: "" }, iconFile: null, iconPreview: "" });
    setError("");
    setOpen(true);
  };
  const closeAdd = () => {
    setOpen(false);
    setError("");
  };
  const updateSubDraft = (k, v) => setDraft((d) => ({ ...d, subDraft: { ...d.subDraft, [k]: v } }));
  const addSub = () => setDraft((d) => {
    const sub = d.subDraft || { title: "", url: "" };
    if (!sub.title.trim() || !sub.url.trim()) return d;
    return {
      ...d,
      subs: [...(d.subs || []), { title: sub.title.trim(), url: sub.url.trim() }],
      subDraft: { title: "", url: "" }
    };
  });
  const removeSub = (i) => setDraft((d) => ({ ...d, subs: d.subs.filter((_, j) => j !== i) }));
  const save = async () => {
    if (!draft.title.trim()) {
      setError("请填写广告标题");
      titleRef.current?.focus();
      return;
    }
    if (!draft.url.trim()) {
      setError("请填写广告链接");
      urlRef.current?.focus();
      return;
    }
    setError("");
    const body = {
      ...draft,
      title: draft.title.trim(),
      url: draft.url.trim(),
      desc: draft.desc.trim(),
      badge: draft.badge.trim(),
      subs: (draft.subs || []).filter((s) => s.title && s.url)
    };
    let id = draft.id;
    if (id) {
      await api.put(`/admin/ads/${id}`, body);
      await api.put(`/admin/ads/${id}/subs`, { subs: body.subs });
    } else {
      const r = await api.post("/admin/ads", body);
      id = r.id;
    }
    if (draft.iconFile) {
      const form = new FormData();
      form.append("icon", draft.iconFile);
      form.append("adId", id);
      await api.upload("/admin/upload-icon", form);
    }
    closeAdd();
    setDraft(emptyDraft);
    reload();
  };
  const pickIcon = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDraft((d) => ({ ...d, iconFile: file, iconPreview: reader.result }));
    reader.readAsDataURL(file);
  };
  const refetch = async () => { await api.post("/admin/refetch-icons", {}); reload(); };
  const remove = async (id) => { await api.del(`/admin/ads/${id}`); reload(); };
  const toggle = async (a) => { await api.put(`/admin/ads/${a.id}`, { visible: !a.visible }); reload(); };
  return (
    <div className="admin-card">
      <AdminHeader title="广告管理">
        <button className="ghost-btn" onClick={refetch}><RefreshCw size={15} />重抓图标</button>
        <button className="primary-btn" onClick={openAdd}><Plus size={15} />新增广告</button>
      </AdminHeader>
      <AdminTable className="mobile-title-action" columns={[
        { key: "title", label: "标题", render: (r) => <strong>{r.title}</strong> },
        { key: "desc", label: "描述" },
        { key: "url", label: "URL", size: "2fr" },
        { key: "visible", label: "状态", size: "90px", render: (r) => <button className={`admin-badge ${r.visible ? "green" : ""}`} onClick={() => toggle(r)}>{r.visible ? "显示" : "隐藏"}</button> },
        { key: "action", label: "操作", render: (r) => <span className="row-actions"><button className="mini-btn green" onClick={() => openEdit(r)}>编辑</button><button className="mini-btn red" onClick={() => remove(r.id)}><Trash2 size={13} />删除</button></span> }
      ]} rows={rows} />
      {open && (
        <div className="edit-overlay" onClick={closeAdd}>
          <div className="edit-modal ad-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-panel-head"><h1>{draft.id ? "编辑广告" : "新增广告"}</h1><button className="popup-close" onClick={closeAdd}><X size={15} /></button></div>
            <div className="admin-grid modal-grid2">
              <div className="field"><label>标题</label><input ref={titleRef} autoFocus value={draft.title} onChange={(e) => { setError(""); setDraft({ ...draft, title: e.target.value }); }} /></div>
              <div className="field"><label>链接</label><input ref={urlRef} value={draft.url} onChange={(e) => { setError(""); setDraft({ ...draft, url: e.target.value }); }} placeholder="https://" /></div>
              <SubLinksEditor subs={draft.subs || []} draft={draft.subDraft} onDraft={updateSubDraft} onAdd={addSub} onRemove={removeSub} />
              <div className="field full"><label>描述</label><input value={draft.desc} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} /></div>
              <div className="field"><label>角标</label><input value={draft.badge} onChange={(e) => setDraft({ ...draft, badge: e.target.value })} /></div>
              <div className="field full">
                <label>图标（上传本地图标，重抓图标时不会覆盖）</label>
                <div className="icon-row">
                  <span className="icon-preview"><img src={draft.iconPreview || iconSrc({ icon: draft.icon, domain: (draft.url || "").replace(/^https?:\/\//, "").split("/")[0] })} alt="" /></span>
                  <label className="ghost-btn">上传本地图标<input type="file" accept="image/*" hidden onChange={(e) => pickIcon(e.target.files[0])} /></label>
                  {draft.iconFile && <span className="muted">已选择：{draft.iconFile.name}</span>}
                </div>
              </div>
            </div>
            {error && <div className="error">{error}</div>}
            <div className="edit-foot">
              <span style={{ flex: 1 }} />
              <button className="ghost-btn" onClick={closeAdd}>取消</button>
              <button className="primary-btn" onClick={save}>{draft.id ? "保存" : "新增"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NoticesAdmin({ sync }) {
  const [rows, load] = useAdminList("/admin/notices");
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({ text: "", url: "", color: "#334155" });
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState({ text: "", url: "", color: "#334155" });
  useEffect(() => { api.get("/admin/settings").then(setSettings).catch(() => {}); }, []);
  const reload = () => { load(); sync(); };
  const updateSetting = (key, value) => setSettings((s) => ({ ...(s || {}), [key]: value }));
  const saveSettings = async () => {
    await api.put("/admin/settings", {
      marqueeEnabled: settings?.marqueeEnabled === "0" ? "0" : "1",
      marqueeSpeed: settings?.marqueeSpeed || "30",
      marqueeGradient: settings?.marqueeGradient === "0" ? "0" : "1",
      marqueeGrad1: settings?.marqueeGrad1 || "#ff6673",
      marqueeGrad2: settings?.marqueeGrad2 || "#4f6ef7",
      marqueeGrad3: settings?.marqueeGrad3 || "#22c55e"
    });
    sync();
  };
  const add = async () => {
    if (!draft.text.trim()) return;
    await api.post("/admin/notices", { text: draft.text.trim(), url: draft.url.trim(), color: draft.color });
    setDraft({ text: "", url: "", color: "#334155" });
    reload();
  };
  const startEdit = (r) => { setEditId(r.id); setEditDraft({ text: r.text || "", url: r.url || "", color: r.color || "#334155" }); };
  const cancelEdit = () => { setEditId(null); setEditDraft({ text: "", url: "", color: "#334155" }); };
  const saveEdit = async (r) => {
    await api.put(`/admin/notices/${r.id}`, { ...editDraft, visible: r.visible });
    cancelEdit();
    reload();
  };
  const toggle = async (r) => { await api.put(`/admin/notices/${r.id}`, { visible: !r.visible }); reload(); };
  const remove = async (id) => { await api.del(`/admin/notices/${id}`); reload(); };
  if (!settings) return <div className="admin-card"><AdminHeader title="跑马灯管理" /><p className="muted">加载中...</p></div>;
  const speed = String(settings.marqueeSpeed || "30");
  const marqueeEnabled = settings.marqueeEnabled !== "0";
  const gradientOn = settings.marqueeGradient !== "0";
  return (
    <>
      <div className="admin-card marquee-config-card">
        <div className="marquee-config-row">
          <strong>跑马灯</strong>
          <label className="marquee-check"><input type="checkbox" checked={marqueeEnabled} onChange={(e) => updateSetting("marqueeEnabled", e.target.checked ? "1" : "0")} />开启</label>
        </div>
        <div className="marquee-config-row">
          <strong>滚动速度</strong>
          <span className="muted">快</span>
          <input type="range" min="8" max="60" value={speed} onChange={(e) => updateSetting("marqueeSpeed", e.target.value)} />
          <span className="muted">慢</span>
          <span>{speed} 秒</span>
        </div>
        <div className="marquee-config-row">
          <strong>文字渐变</strong>
          <label className="marquee-check"><input type="checkbox" checked={gradientOn} onChange={(e) => updateSetting("marqueeGradient", e.target.checked ? "1" : "0")} />开启</label>
          <input type="color" value={settings.marqueeGrad1 || "#ff6673"} onChange={(e) => updateSetting("marqueeGrad1", e.target.value)} />
          <span className="muted">→</span>
          <input type="color" value={settings.marqueeGrad2 || "#4f6ef7"} onChange={(e) => updateSetting("marqueeGrad2", e.target.value)} />
          <span className="muted">→</span>
          <input type="color" value={settings.marqueeGrad3 || "#22c55e"} onChange={(e) => updateSetting("marqueeGrad3", e.target.value)} />
          <span className="marquee-preview marquee-grad" style={{ "--grad": neonMarqueeGradient([settings.marqueeGrad1 || "#ff6673", settings.marqueeGrad2 || "#4f6ef7", settings.marqueeGrad3 || "#22c55e"]) }}>欢迎来到导航站</span>
          <button className="primary-btn marquee-save-btn" onClick={saveSettings}>保存配置</button>
        </div>
      </div>
      <div className="admin-card marquee-list-card">
        <div className="admin-filter-bar marquee-add-bar">
          <input value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="文字" />
          <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="链接（可选）" />
          <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
          <button className="primary-btn" onClick={add}><Plus size={15} />新增</button>
        </div>
        <AdminTable className="marquee-admin-table" minWidth={760} columns={[
          { key: "text", label: "文字", size: "2fr", render: (r) => editId === r.id ? <input className="inline-edit-input" value={editDraft.text} autoFocus onChange={(e) => setEditDraft({ ...editDraft, text: e.target.value })} /> : <strong>{r.text}</strong> },
          { key: "url", label: "链接", size: "1.5fr", render: (r) => editId === r.id ? <input className="inline-edit-input" value={editDraft.url} onChange={(e) => setEditDraft({ ...editDraft, url: e.target.value })} /> : (r.url || "-") },
          { key: "color", label: "颜色", size: "90px", render: (r) => editId === r.id ? <input type="color" value={editDraft.color} onChange={(e) => setEditDraft({ ...editDraft, color: e.target.value })} /> : <span className="marquee-color-dot" style={{ background: r.color || "#334155" }} /> },
          { key: "visible", label: "可见", size: "90px", render: (r) => <button className={`admin-badge ${r.visible ? "green" : ""}`} onClick={() => toggle(r)}>{r.visible ? "显示" : "隐藏"}</button> },
          { key: "action", label: "操作", size: "160px", render: (r) => editId === r.id
            ? <span className="row-actions"><button className="mini-btn green" onClick={() => saveEdit(r)}>保存</button><button className="mini-btn" onClick={cancelEdit}>取消</button></span>
            : <span className="row-actions"><button className="mini-btn green" onClick={() => startEdit(r)}>编辑</button><button className="mini-btn red" onClick={() => remove(r.id)}>删除</button></span> }
        ]} rows={rows} />
      </div>
    </>
  );
}

function BannersAdmin({ sync }) {
  const [rows, load] = useAdminList("/admin/banners");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const reload = () => { load(); sync(); };
  const add = async () => {
    const nextUrl = url.trim();
    if (!nextUrl) return setError("请先填写图片 URL");
    try {
      await api.post("/admin/banners", { url: nextUrl });
      setUrl("");
      setError("");
      reload();
    } catch (e) {
      setError(e.message);
    }
  };
  const uploadLocal = async (file) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("image", file);
      await api.upload("/admin/upload-banner", form);
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };
  const remove = async (id) => { await api.del(`/admin/banners/${id}`); reload(); };
  const toggleVisible = async (row) => {
    await api.put(`/admin/banners/${row.id}`, { visible: !row.visible });
    reload();
  };
  return (
    <div className="admin-card">
      <AdminHeader title="图片管理"><button className="primary-btn" onClick={add}><Plus size={15} />新增横幅</button></AdminHeader>
      <div className="admin-filter-bar">
        <input value={url} onChange={(e) => { setError(""); setUrl(e.target.value); }} placeholder="图片 URL" />
        <label className="ghost-btn">{uploading ? "上传中..." : "上传本地图片"}<input type="file" accept="image/*" hidden onChange={(e) => uploadLocal(e.target.files[0])} /></label>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="banner-admin-grid">
        {rows.map((b, i) => (
          <div className="banner-admin-item" key={b.id}>
            <img src={b.url} alt="" />
            <span>横幅 {i + 1}</span>
            <span className="banner-admin-actions">
              <button className={`mini-btn ${b.visible ? "green" : ""}`} onClick={() => toggleVisible(b)}>{b.visible ? "显示" : "隐藏"}</button>
              <button className="mini-btn red" onClick={() => remove(b.id)}>删除</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ColorsAdmin({ data, sync }) {
  const [kind, setKind] = useState("links");
  const [filter, setFilter] = useState("all");
  const rows = (kind === "links" ? data.links : data.ads).filter((r) => kind === "ads" || filter === "all" || r.cat === filter);
  const setColor = async (row, field, value) => {
    const body = { titleColor: row.titleColor || "", descColor: row.descColor || "", badgeColor: row.badgeColor || "" };
    body[field] = value;
    await api.put(`/admin/${kind === "links" ? "links" : "ads"}/${row.id}/colors`, body);
    sync();
  };
  return (
    <div className="admin-card">
      <div className="admin-panel-head grad-head">
        <div className="grad-tabs">
          <button className={`grad-tab ${kind === "links" ? "active" : ""}`} onClick={() => setKind("links")}>卡片</button>
          <button className={`grad-tab ${kind === "ads" ? "active" : ""}`} onClick={() => setKind("ads")}>广告</button>
        </div>
        {kind === "links" && <select className="grad-filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部分类</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      </div>
      <AdminTable className="color-admin-table" minWidth={640} columns={[
        { key: "title", label: "名称", render: (r) => <strong style={r.titleColor ? { color: r.titleColor } : undefined}>{r.title}</strong> },
        { key: "desc", label: "描述", size: "1.6fr", render: (r) => <span style={r.descColor ? { color: r.descColor } : undefined}>{r.desc}</span> },
        { key: "titleColor", label: "标题色", size: "90px", render: (r) => <input type="color" value={r.titleColor || "#1a1a2e"} onChange={(e) => setColor(r, "titleColor", e.target.value)} /> },
        { key: "descColor", label: "描述色", size: "90px", render: (r) => <input type="color" value={r.descColor || "#6b7280"} onChange={(e) => setColor(r, "descColor", e.target.value)} /> },
        { key: "badgeColor", label: "角标色", size: "90px", render: (r) => <input type="color" value={r.badgeColor || "#ef4444"} onChange={(e) => setColor(r, "badgeColor", e.target.value)} /> }
      ]} rows={rows} />
    </div>
  );
}

function GradientsAdmin({ data, sync }) {
  const [kind, setKind] = useState("links");
  const [filter, setFilter] = useState("all");
  const [drafts, setDrafts] = useState({});
  const defaultGrad = ["#60a5fa", "#f472b6", "#60a5fa"];
  const rows = (kind === "links" ? data.links : data.ads).filter((r) => kind === "ads" || filter === "all" || r.cat === filter);
  const keyFor = (row) => `${kind}-${row.id}`;
  const colorsFor = (row) => drafts[keyFor(row)] || row.descGradient || defaultGrad;
  const updateGradient = (row, color, index) => {
    const key = keyFor(row);
    const grad = [...colorsFor(row)];
    grad[index] = color;
    setDrafts((d) => ({ ...d, [key]: grad }));
  };
  const saveGradient = async (row) => {
    const key = keyFor(row);
    await api.put(`/admin/${kind === "links" ? "links" : "ads"}/${row.id}/desc-gradient`, { gradient: colorsFor(row) });
    setDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
    await sync();
  };
  const catName = (row) => data.categories.find((c) => c.id === row.cat)?.name || "未分类";
  return (
    <div className="admin-card gradient-admin-card">
      <div className="gradient-page-head">
        <h1>颜色渐变</h1>
        <p>给卡片描述和广告描述设置渐变文字。留空则使用普通颜色。</p>
      </div>
      <div className="gradient-toolbar">
        <div className="grad-tabs">
          <button className={`grad-tab ${kind === "links" ? "active" : ""}`} onClick={() => setKind("links")}>卡片描述 ({data.links.length})</button>
          <button className={`grad-tab ${kind === "ads" ? "active" : ""}`} onClick={() => setKind("ads")}>广告描述 ({data.ads.length})</button>
        </div>
        {kind === "links" && <select className="grad-filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部分类</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      </div>
      <div className="gradient-list">
        {rows.map((row) => (
          <div className="gradient-row" key={row.id}>
            <div className="gradient-meta">
              <strong>{row.title}</strong>
              <span>{kind === "links" ? catName(row) : "广告描述"}</span>
              <small>{row.desc || "暂无描述"}</small>
            </div>
            <div className="gradient-controls">
              <div className="gradient-color-row">
                {colorsFor(row).map((color, i) => (
                  <input key={i} type="color" value={color} onChange={(e) => updateGradient(row, e.target.value, i)} />
                ))}
              </div>
              <select className="grad-direction" defaultValue="90deg" aria-label="渐变方向">
                <option value="90deg">→</option>
                <option value="270deg">←</option>
                <option value="180deg">↓</option>
                <option value="0deg">↑</option>
              </select>
            </div>
            <button className="gradient-save" onClick={() => saveGradient(row)}>保存</button>
          </div>
        ))}
        {!rows.length && <div className="admin-empty">暂无数据</div>}
      </div>
    </div>
  );
}

function ThemesAdmin({ data, sync }) {
  const themes = [
    { id: "current", name: "现有默认", desc: "保留现在电脑端前台外观，移动端和全部功能不变。" },
    { id: "clean", name: "简洁工具站", desc: "白底、细边框、轻阴影，内容更干净，适合大量工具和资源。" },
    { id: "portal", name: "门户导航", desc: "广告、搜索和分类入口更突出，更适合上线运营和广告展示。" },
    { id: "pro", name: "高级灰后台风", desc: "深色侧栏搭配浅色内容区，专业、规整，偏工具平台。" },
    { id: "fresh", name: "清新蓝绿", desc: "蓝绿主色、轻量卡片和柔和背景，整体更明亮友好。" }
  ];
  const savedTheme = data.settings?.frontTheme || "current";
  const theme = themes.some((item) => item.id === savedTheme) ? savedTheme : "current";
  const applyTheme = async (id) => {
    await api.put("/admin/settings", { frontTheme: id });
    await sync();
  };
  return (
    <div className="admin-card theme-admin-card">
      <AdminHeader title="主题管理" />
      <p className="muted theme-admin-intro">现有电脑端和移动端都保留；下面 4 套新增主题只影响电脑端前台，可随时切换。</p>
      <div className="theme-grid">
        {themes.map((item) => (
          <button className={`theme-card ${theme === item.id ? "active" : ""}`} key={item.id} onClick={() => applyTheme(item.id)}>
            <span className={`theme-preview theme-${item.id}`}>
              <i />
              <b />
              <em />
            </span>
            <strong>{item.name}</strong>
            <small>{item.desc}</small>
            <span className="theme-apply">{theme === item.id ? "已应用" : "应用主题"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StatsAdmin() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api.get("/admin/stats").then(setStats).catch(() => {}); }, []);
  if (!stats) return <div className="admin-card"><AdminHeader title="访客统计" /><p className="muted">加载中...</p></div>;
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
      <div className="visit-log-panel">
        <div className="visit-log-head">
          <strong>最近访客浏览记录</strong>
          <span>真实访问路径、IP、浏览器和时间</span>
        </div>
        <div className="visit-log-table">
          <div className="visit-log-row head"><span>时间</span><span>访问页面</span><span>IP</span><span>浏览器</span></div>
          {(stats.visits || []).map((v) => (
            <div className="visit-log-row" key={v.id}>
              <span>{v.time}</span>
              <span title={v.path}>{v.path}</span>
              <span>{v.ip}</span>
              <span>{v.browser}</span>
            </div>
          ))}
          {(!stats.visits || stats.visits.length === 0) && <div className="admin-empty">暂无访问记录</div>}
        </div>
      </div>
    </div>
  );
}

function UsersAdmin({ data, sync, user }) {
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
  const toggleRole = async (u) => { await api.put(`/admin/users/${u.id}`, { role: u.role === "admin" ? "user" : "admin" }); loadUsers(); };
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
        { key: "role", label: "角色", render: (r) => <span className="admin-badge red">{r.adminLevel === "owner" ? "owner" : r.role}</span> },
        { key: "color", label: "昵称/角色色", render: (r) => <span className="gradient-pickers"><input type="color" value={r.nickname_color || "#4f6ef7"} onChange={(e) => saveColor(r, "nickname_color", e.target.value)} /><input type="color" value={r.role_color || "#ef4444"} onChange={(e) => saveColor(r, "role_color", e.target.value)} /></span> },
        { key: "action", label: "操作", size: "220px", render: (r) => <span className="row-actions">
          {r.adminLevel !== "owner" && <button className="mini-btn green" onClick={() => toggleRole(r)}>{r.role === "admin" ? "设为用户" : "升级管理员"}</button>}
          {String(r.id) !== String(user?.id) && r.adminLevel !== "owner" && <button className="mini-btn red" onClick={() => delUser(r)}>删除</button>}
        </span> }
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
  if (!settings) return <div className="admin-card"><AdminHeader title="弹窗公告" /><p className="muted">加载中...</p></div>;
  const save = async () => { await api.put("/admin/settings", { popupEnabled: settings.popupEnabled, noticeTitle: settings.noticeTitle, noticeText: settings.noticeText, noticeImage: settings.noticeImage, noticeTgUrl: settings.noticeTgUrl, noticeTgText: settings.noticeTgText }); sync(); };
  return (
    <div className="admin-card">
      <AdminHeader title="弹窗公告"><button className="primary-btn" onClick={save}>保存公告</button></AdminHeader>
      <label className="check-line"><input type="checkbox" checked={settings.popupEnabled} onChange={(e) => setSettings({ ...settings, popupEnabled: e.target.checked })} />启用弹窗公告</label>
      <div className="admin-grid">
        <div className="field"><label>标题</label><input value={settings.noticeTitle || ""} onChange={(e) => setSettings({ ...settings, noticeTitle: e.target.value })} /></div>
        <div className="field"><label>图片</label><input value={settings.noticeImage || ""} onChange={(e) => setSettings({ ...settings, noticeImage: e.target.value })} /></div>
        <div className="field"><label>TG 按钮文字</label><input placeholder="TG联系" value={settings.noticeTgText || ""} onChange={(e) => setSettings({ ...settings, noticeTgText: e.target.value })} /></div>
        <div className="field full"><label>TG 链接</label><input placeholder="https://t.me/你的用户名" value={settings.noticeTgUrl || ""} onChange={(e) => setSettings({ ...settings, noticeTgUrl: e.target.value })} /></div>
        <div className="field full"><label>内容</label><textarea value={settings.noticeText || ""} onChange={(e) => setSettings({ ...settings, noticeText: e.target.value })} /></div>
      </div>
    </div>
  );
}

function FontsAdmin({ sync }) {
  const [settings, setSettings] = useState(null);
  const fontOptions = [
    ['-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif', "系统默认"],
    ['"Microsoft YaHei", "PingFang SC", sans-serif', "微软雅黑"],
    ['"PingFang SC", "Microsoft YaHei", sans-serif', "苹方"],
    ['"HarmonyOS Sans SC", "Microsoft YaHei", sans-serif', "HarmonyOS"],
    ['"Noto Sans SC", "Microsoft YaHei", sans-serif', "思源黑体"],
    ['Georgia, "Times New Roman", "Songti SC", serif', "衬线"]
  ];
  useEffect(() => { api.get("/admin/settings").then(setSettings).catch(() => {}); }, []);
  if (!settings) return <div className="admin-card"><AdminHeader title="字体管理" /><p className="muted">加载中...</p></div>;
  const set = (k, v) => setSettings({ ...settings, [k]: v });
  const previewStyle = {
    fontFamily: settings.fontFamily || fontOptions[0][0],
    fontSize: `${Number(settings.bodyFontSize) || 14}px`
  };
  const save = async () => {
    await api.put("/admin/settings", {
      fontFamily: settings.fontFamily || fontOptions[0][0],
      titleWeight: settings.titleWeight || "800",
      bodyFontSize: settings.bodyFontSize || "14",
      cardTitleSize: settings.cardTitleSize || "14",
      marqueeFontSize: settings.marqueeFontSize || "14"
    });
    sync();
  };
  return (
    <div className="admin-card">
      <AdminHeader title="字体管理"><button className="primary-btn" onClick={save}>保存字体</button></AdminHeader>
      <div className="admin-grid">
        <div className="field full">
          <label>全站字体</label>
          <select value={settings.fontFamily || fontOptions[0][0]} onChange={(e) => set("fontFamily", e.target.value)}>
            {fontOptions.map(([value, label]) => <option value={value} key={label}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>标题字重</label>
          <select value={settings.titleWeight || "800"} onChange={(e) => set("titleWeight", e.target.value)}>
            <option value="600">偏细</option>
            <option value="700">正常</option>
            <option value="800">加粗</option>
            <option value="900">特粗</option>
          </select>
        </div>
        <div className="field">
          <label>正文大小</label>
          <input type="number" min="12" max="18" value={settings.bodyFontSize || "14"} onChange={(e) => set("bodyFontSize", e.target.value)} />
        </div>
        <div className="field">
          <label>卡片标题大小</label>
          <input type="number" min="12" max="20" value={settings.cardTitleSize || "14"} onChange={(e) => set("cardTitleSize", e.target.value)} />
        </div>
        <div className="field">
          <label>跑马灯大小</label>
          <input type="number" min="12" max="22" value={settings.marqueeFontSize || "14"} onChange={(e) => set("marqueeFontSize", e.target.value)} />
        </div>
      </div>
      <div className="font-preview" style={previewStyle}>
        <strong style={{ fontWeight: settings.titleWeight || "800", fontSize: `${Number(settings.cardTitleSize) || 14}px` }}>字体预览标题</strong>
        <span>这是一段前台正文预览，用来检查字体、大小和粗细是否合适。</span>
        <em style={{ fontSize: `${Number(settings.marqueeFontSize) || 14}px` }}>跑马灯文字预览</em>
      </div>
    </div>
  );
}

function SettingsPanel({ sync, user }) {
  const [settings, setSettings] = useState(null);
  const [account, setAccount] = useState({ username: user?.username || "", oldPassword: "" });
  const [accountMsg, setAccountMsg] = useState("");
  const [accountOk, setAccountOk] = useState(false);
  const [pw, setPw] = useState({ oldPassword: "", newPassword: "" });
  const [pwMsg, setPwMsg] = useState("");
  const [pwOk, setPwOk] = useState(false);
  useEffect(() => { setAccount((a) => ({ ...a, username: user?.username || "" })); }, [user?.username]);
  useEffect(() => { api.get("/admin/settings").then(setSettings).catch(() => {}); }, []);
  if (!settings) return <div className="admin-card"><AdminHeader title="网站设置" /><p className="muted">加载中...</p></div>;
  const set = (k, v) => setSettings({ ...settings, [k]: v });
  const save = async () => {
    await api.put("/admin/settings", {
      title: settings.title, subtitle: settings.subtitle, logoText: settings.logoText,
      searchPlaceholder: settings.searchPlaceholder, footer: settings.footer
    });
    sync();
  };
  const changeAdminPassword = async () => {
    setPwMsg("");
    setPwOk(false);
    try {
      await api.post("/auth/change-password", pw);
      setPw({ oldPassword: "", newPassword: "" });
      setPwMsg("管理员密码已修改");
      setPwOk(true);
    } catch (e) {
      setPwMsg(e.message);
      setPwOk(false);
    }
  };
  const changeAdminAccount = async () => {
    setAccountMsg("");
    setAccountOk(false);
    try {
      const r = await api.post("/auth/change-account", account);
      if (r.token) { setToken(r.token); markActive(); }
      setAccount({ username: r.user?.username || account.username, oldPassword: "" });
      setAccountMsg("管理员账号已修改");
      setAccountOk(true);
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      setAccountMsg(e.message);
      setAccountOk(false);
    }
  };
  return (
    <>
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
      <div className="admin-card">
        <AdminHeader title="管理员密码"><button className="primary-btn" onClick={changeAdminPassword}>保存密码</button></AdminHeader>
        <div className="admin-grid">
          <div className="field"><label>原密码</label><input type="password" value={pw.oldPassword} onChange={(e) => setPw({ ...pw, oldPassword: e.target.value })} /></div>
          <div className="field"><label>新密码</label><input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></div>
        </div>
        {pwMsg && <div className={pwOk ? "success" : "error"}>{pwMsg}</div>}
      </div>
      <div className="admin-card">
        <AdminHeader title="管理员账号"><button className="primary-btn" onClick={changeAdminAccount}>保存账号</button></AdminHeader>
        <div className="admin-grid">
          <div className="field"><label>新账号</label><input value={account.username} onChange={(e) => setAccount({ ...account, username: e.target.value })} /></div>
          <div className="field"><label>原密码</label><input type="password" value={account.oldPassword} onChange={(e) => setAccount({ ...account, oldPassword: e.target.value })} /></div>
        </div>
        {accountMsg && <div className={accountOk ? "success" : "error"}>{accountMsg}</div>}
      </div>
    </>
  );
}

function BottomNav({ hidden, user }) {
  const location = useLocation();
  if (location.pathname.startsWith("/admin")) return null;
  const meTarget = user ? "/me" : "/login";
  const items = [
    { to: "/", label: "首页", icon: HomeIcon },
    { to: "/submit", label: "投稿", icon: Send },
    { to: meTarget, label: "我的", icon: User, activePaths: ["/me", "/login"] }
  ];
  return (
    <nav className={`bottom-nav ${hidden ? "hidden" : ""}`}>
      {items.map(({ to, label, icon: Icon, activePaths }) => {
        const active = activePaths ? activePaths.includes(location.pathname) : location.pathname === to;
        return <NavLink key={label} to={to} className={`bn-item ${active ? "active" : ""}`}><span className="bn-ico"><Icon /></span>{label}</NavLink>;
      })}
    </nav>
  );
}

function NotFound() {
  return <main className="form-page"><div className="form-card"><h1>未找到页面</h1><Link className="primary-btn" to="/">返回首页</Link></div></main>;
}

export default App;
