import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, Route, Routes, useParams, Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";

type Item = Record<string, string | number | null>;
type User = { id: string; email: string; display_name: string; role: string };

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

async function postJSON(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let data: Record<string, unknown> = {};
  try { data = (await r.json()) as Record<string, unknown>; } catch { data = { error: await r.text() }; }
  return { status: r.status, data };
}

function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!url);
  useEffect(() => {
    if (!url) return;
    let live = true;
    setLoading(true);
    setError("");
    getJSON<T>(url).then((d) => live && setData(d)).catch((e: Error) => live && setError(e.message || "Could not load.")).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [url]);
  return { data, error, loading };
}

function useMe() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = () => {
    setLoading(true);
    getJSON<{ user: User }>("/api/me").then((d) => setUser(d.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  };
  useEffect(refresh, []);
  return { user, loading, refresh };
}

function usePager<T>(items: T[], perPage = 8) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const cur = Math.min(page, pages);
  const slice = items.slice((cur - 1) * perPage, cur * perPage);
  useEffect(() => { setPage(1); }, [items.length]);
  return { slice, cur, pages, setPage, total: items.length };
}

function fmtDate(ts: unknown): string {
  const n = Number(ts);
  if (!n) return "—";
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getFullYear() > 2100) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ---- Turnstile (renders only when a site key is configured) ----
interface TurnstileApi {
  render(el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void }): string;
}
declare global { interface Window { turnstile?: TurnstileApi; } }

let turnstileScript: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (typeof window.turnstile !== "undefined") return Promise.resolve();
  if (!turnstileScript) {
    turnstileScript = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("captcha failed to load"));
      document.head.appendChild(s);
    });
  }
  return turnstileScript;
}

function Turnstile({ onToken }: { onToken: (t: string) => void }) {
  const [key, setKey] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    getJSON<{ turnstileSiteKey: string }>("/api/config")
      .then((c) => setKey(c.turnstileSiteKey || null))
      .catch(() => setKey(null));
  }, []);
  useEffect(() => {
    if (!key || !ref.current) return;
    let live = true;
    loadTurnstile().then(() => {
      if (live && ref.current && window.turnstile) {
        window.turnstile.render(ref.current, { sitekey: key, callback: onToken });
      }
    }).catch(() => { /* server still validates when configured */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return null;
  return <div ref={ref} style={{ margin: "8px 0" }} />;
}

function SignInGate({ user, loading, children }: { user: User | null; loading: boolean; children: ReactNode }) {
  if (loading) return <p className="muted">Checking your session…</p>;
  if (!user) return <div className="notice"><strong>Sign in to share.</strong><p>Reading is free for everyone. Sharing needs a sign-in so moderators know who gave what.</p><Link className="btn btn-primary" to="/signin">Sign in with email</Link></div>;
  return <>{children}</>;
}

// ---- Dashboard frame ----
const NAV_COMMONS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/knowledge", label: "Knowledge" },
  { to: "/software", label: "Software" },
  { to: "/files", label: "Files" },
  { to: "/services", label: "Services" },
  { to: "/social", label: "Gatherings" },
];

function Sidebar({ me, open, close }: { me: ReturnType<typeof useMe>; open: boolean; close: () => void }) {
  const isMod = !!me.user && (me.user.role === "admin" || me.user.role === "moderator");
  const { data: queue } = useApi<{ pending: Record<string, Item[]> }>(isMod ? "/api/moderate/pending" : null);
  const pendingCount = useMemo(() => Object.values(queue?.pending ?? {}).reduce((n, v) => n + v.length, 0), [queue]);
  const { data: recent } = useApi<{ items: Item[] }>("/api/knowledge");
  return (
    <aside className={`sidebar${open ? " open" : ""}`} aria-label="Primary">
      <div className="side-scroll">
        <div className="brand-row">
          <Link className="brand" to="/" onClick={close}><span className="brand-mark">H</span><strong>Hitaisi</strong></Link>
          <button className="iconbtn drawer-close" onClick={close} aria-label="Close menu">✕</button>
        </div>
        <div className="side-label">Commons</div>
        <nav>
          {NAV_COMMONS.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={close} className={({ isActive }) => `side-item${isActive ? " active" : ""}`}>
              <span className="grow">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-label">Workspace</div>
        <nav>
          <NavLink to="/moderate" onClick={close} className={({ isActive }) => `side-item${isActive ? " active" : ""}`}>
            <span className="grow">Review Queue</span>
            {isMod && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </NavLink>
          <NavLink to="/submit" onClick={close} className={({ isActive }) => `side-item${isActive ? " active" : ""}`}>
            <span className="grow">Share something</span>
          </NavLink>
        </nav>
        <div className="side-label">Latest guides</div>
        <nav>
          {(recent?.items ?? []).slice(0, 4).map((g) => (
            <Link key={String(g.id)} className="run-row" to={`/knowledge/${g.slug}`} onClick={close}>
              <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(g.title)}</span>
            </Link>
          ))}
          {(!recent?.items?.length) && <span className="run-row muted">No guides yet.</span>}
        </nav>
        <div className="usage">
          <div><strong>Free forever.</strong></div>
          <div className="muted" style={{ fontSize: 13 }}>Everything here is shared, not sold.</div>
          <div style={{ marginTop: 10 }}><Link className="btn btn-sm" to="/submit" onClick={close}>Share something</Link></div>
        </div>
      </div>
      {me.user ? (
        <Link className="profile" to="/signin" onClick={close}>
          <span className="avatar">{me.user.display_name.slice(0, 1).toUpperCase()}</span>
          <span style={{ minWidth: 0 }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me.user.display_name}</strong><span className="muted" style={{ fontSize: 12 }}>{me.user.email}</span></span>
        </Link>
      ) : (
        <Link className="profile" to="/signin" onClick={close}>
          <span className="avatar">?</span>
          <span><strong>Sign in</strong><br /><span className="muted" style={{ fontSize: 12 }}>to share &amp; moderate</span></span>
        </Link>
      )}
    </aside>
  );
}

const CRUMBS: Record<string, string> = {
  "/": "Dashboard", "/knowledge": "Knowledge", "/software": "Software", "/files": "Files",
  "/services": "Services", "/social": "Gatherings", "/moderate": "Review Queue",
  "/submit": "Share", "/signin": "Sign in", "/search": "Search",
};

function Shell({ me, children }: { me: ReturnType<typeof useMe>; children: ReactNode }) {
  const [theme, setTheme] = useState("light");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const loc = useLocation();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  const base = "/" + loc.pathname.split("/")[1];
  const crumb = CRUMBS[base] ?? "Hitaisi";
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    me.refresh();
    navigate("/");
  }
  return (
    <div className="app">
      <div className={`side-overlay${open ? " show" : ""}`} onClick={() => setOpen(false)} />
      <Sidebar me={me} open={open} close={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="iconbtn hamb" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
          <div className="crumbs"><span className="muted crumb-parent">Hitaisi</span><span className="muted crumb-parent">›</span><span>{crumb}</span></div>
          <div className="top-actions">
            <form className="searchbox" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}>
              <span aria-hidden>⌕</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the commons" aria-label="Search" />
              <kbd>↵</kbd>
            </form>
            <button className="iconbtn" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))} aria-label="Toggle theme">{theme === "light" ? "◐" : "◑"}</button>
            {me.user ? <button className="btn btn-sm" onClick={() => void logout()}><span className="btn-text">Sign out</span></button>
              : <Link className="btn btn-sm btn-primary" to="/signin"><span className="btn-text">Sign in</span></Link>}
          </div>
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
  );
}

// ---- Pages ----
function Stat({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return <div className="stat"><small>{label}</small><div className="num">{loading ? "…" : value}</div></div>;
}

function Dashboard() {
  const k = useApi<{ items: Item[] }>("/api/knowledge");
  const s = useApi<{ items: Item[] }>("/api/software");
  const f = useApi<{ items: Item[] }>("/api/files");
  const e = useApi<{ items: Item[] }>("/api/events");
  const guides = k.data?.items ?? [];
  const events = useMemo(() => [...(e.data?.items ?? [])].sort((a, b) => Number(a.starts_at) - Number(b.starts_at)), [e.data]);
  return (
    <div className="reveal">
      <div className="page-head">
        <div><h1 className="display">What was freely given.</h1><p>Guides, software, files, help and gatherings — read everything, share after review.</p></div>
        <div className="head-actions"><Link className="btn" to="/social">Join a gathering</Link><Link className="btn btn-primary" to="/submit">Share something</Link></div>
      </div>
      <div className="stat-grid stagger">
        <Stat label="Guides live" value={String(guides.length)} loading={k.loading} />
        <Stat label="Software entries" value={String(s.data?.items.length ?? 0)} loading={s.loading} />
        <Stat label="Files in library" value={String(f.data?.items.length ?? 0)} loading={f.loading} />
        <Stat label="Gatherings upcoming" value={String(events.length)} loading={e.loading} />
      </div>
      <div className="sec-head"><h2>Latest guides</h2><Link className="linkbtn" to="/knowledge">View all</Link></div>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Guide</th><th>Read</th><th>Published</th><th>Status</th></tr></thead><tbody>
        {guides.slice(0, 6).map((g) => (
          <tr key={String(g.id)}><td><Link to={`/knowledge/${g.slug}`}><strong>{String(g.title)}</strong></Link><div className="muted" style={{ fontSize: 13 }}>{String(g.summary ?? "").slice(0, 90)}</div></td><td>{String(g.read_minutes ?? "—")} min</td><td>{fmtDate(g.created_at)}</td><td><span className="pill p-active">Live</span></td></tr>
        ))}
        {!k.loading && !guides.length && <tr><td colSpan={4} className="muted">No guides yet — <Link to="/submit">write the first one</Link>.</td></tr>}
      </tbody></table></div>
      <div className="sec-head"><h2>Upcoming gatherings</h2><Link className="linkbtn" to="/social">View all</Link></div>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Gathering</th><th>Place</th><th>Date</th><th>Status</th></tr></thead><tbody>
        {events.slice(0, 6).map((v) => (
          <tr key={String(v.id)}><td><strong>{String(v.title)}</strong></td><td>{String(v.place)}</td><td>{fmtDate(v.starts_at)}</td><td><span className="pill p-pending">Open</span></td></tr>
        ))}
        {!e.loading && !events.length && <tr><td colSpan={4} className="muted">Nothing scheduled — propose one from Gatherings.</td></tr>}
      </tbody></table></div>
    </div>
  );
}

function SignIn({ me }: { me: ReturnType<typeof useMe> }) {
  const [msg, setMsg] = useState("");
  const [devLink, setDevLink] = useState("");
  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const { data } = await postJSON("/api/auth/request", { email: fd.get("email") });
    setMsg(String(data.message ?? data.error ?? ""));
    setDevLink(String(data.devLink ?? ""));
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    me.refresh();
  }
  if (me.user) return <div className="page-head"><div><h1 className="display">Signed in as {me.user.display_name}.</h1><p>{me.user.email} · {me.user.role}</p></div><div className="head-actions"><button className="btn" onClick={() => void logout()}>Sign out</button><Link className="btn btn-primary" to="/submit">Share something</Link></div></div>;
  return (
    <div className="reveal" style={{ maxWidth: 520 }}>
      <div className="page-head"><div><h1 className="display">Sign in with email.</h1><p>No passwords. We send a 15-minute link.</p></div></div>
      <div className="card">
        {msg && <p role="status">{msg}</p>}
        {devLink && <p><Link to={devLink.replace(/^https?:\/\/[^/]+/, "")}>Use this sign-in link (dev only)</Link></p>}
        <form onSubmit={(e) => void send(e)}>
          <div className="field"><label htmlFor="si-email">Email</label><input id="si-email" name="email" type="email" placeholder="you@example.com" required /></div>
          <div style={{ marginTop: 12 }}><button className="btn btn-primary" type="submit">Send the link</button></div>
        </form>
      </div>
    </div>
  );
}

function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const { data, error, loading } = useApi<{ items: Item[] }>(q ? `/api/search?q=${encodeURIComponent(q)}` : null);
  const hubPath = (hub: unknown, ref: unknown) => hub === "knowledge" ? `/knowledge/${ref}` : hub === "software" ? "/software" : hub === "files" ? "/files" : hub === "services" ? "/services" : "/";
  return (
    <div className="reveal">
      <div className="page-head"><div><h1 className="display">Results for “{q}”.</h1><p>{data ? `${data.items.length} matches across the commons.` : ""}</p></div></div>
      {loading && <p className="muted">Searching…</p>}
      {error && <div className="notice">Search failed ({error}).</div>}
      {data && !data.items.length && <div className="notice"><strong>Nothing found.</strong><p>Try fewer words, or be the first to share it.</p></div>}
      {!!data?.items.length && (
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Result</th><th>Hub</th></tr></thead><tbody>
          {data.items.map((it, i) => (
            <tr key={i}><td><Link to={hubPath(it.hub, it.ref)}><strong>{String(it.title)}</strong></Link><div className="muted" style={{ fontSize: 13 }}>{String(it.summary ?? "")}</div></td><td><span className="pill p-pending">{String(it.hub)}</span></td></tr>
          ))}
        </tbody></table></div>
      )}
    </div>
  );
}

function KnowledgeList() {
  const { data, error, loading } = useApi<{ items: Item[] }>("/api/knowledge");
  const [fq, setFq] = useState("");
  const items = (data?.items ?? []).filter((g) => !fq || String(g.title).toLowerCase().includes(fq.toLowerCase()));
  const pg = usePager(items);
  return (
    <div className="reveal">
      <div className="page-head"><div><h1 className="display">Knowledge.</h1><p>Longform guides, free to read and reuse with credit.</p></div><div className="head-actions"><Link className="btn btn-primary" to="/submit">Write a guide</Link></div></div>
      <div className="stat-grid stagger" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <Stat label="Guides live" value={String(data?.items.length ?? 0)} loading={loading} />
        <Stat label="Total reading time" value={`${(data?.items ?? []).reduce((n, g) => n + Number(g.read_minutes ?? 0), 0)} min`} loading={loading} />
      </div>
      <div className="filters"><input type="search" placeholder="Search guides…" value={fq} onChange={(e) => setFq(e.target.value)} aria-label="Search guides" /></div>
      {error && <div className="notice">Guides failed to load ({error}).</div>}
      {!loading && !items.length && <div className="notice"><strong>{fq ? "No guides match that search." : "No guides yet."}</strong><p>Be the first to share one — it goes live after a quick review.</p></div>}
      {!!items.length && (
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Guide</th><th>Read</th><th>Published</th><th>Status</th></tr></thead><tbody>
          {pg.slice.map((g) => (
            <tr key={String(g.id)}><td><Link to={`/knowledge/${g.slug}`}><strong>{String(g.title)}</strong></Link><div className="muted" style={{ fontSize: 13 }}>{String(g.summary ?? "")}</div></td><td>{String(g.read_minutes ?? "—")} min</td><td>{fmtDate(g.created_at)}</td><td><span className="pill p-active">Live</span></td></tr>
          ))}
        </tbody></table></div>
      )}
      {pg.pages > 1 && <div className="pager"><span>Showing {pg.slice.length} of {pg.total}</span><nav>{Array.from({ length: pg.pages }, (_, i) => i + 1).map((p) => <button key={p} className={`pagebtn${p === pg.cur ? " cur" : ""}`} onClick={() => pg.setPage(p)}>{p}</button>)}</nav></div>}
    </div>
  );
}

function KnowledgeDetail() {
  const { slug } = useParams();
  const { data, error, loading } = useApi<{ item: Item }>(slug ? `/api/knowledge/${slug}` : null);
  if (loading) return <p className="muted">Opening the guide…</p>;
  if (error || !data) return <div className="notice">That guide is missing or awaiting review. <Link to="/knowledge">Back to guides</Link></div>;
  return (
    <div className="reveal">
      <div className="page-head"><div><h1 className="display">{String(data.item.title)}</h1><p>{String(data.item.summary)}</p></div><div className="head-actions"><Link className="btn" to="/knowledge">All guides</Link></div></div>
      <div className="detail-grid">
        <div className="card"><pre className="prose-body">{String(data.item.body_md)}</pre></div>
        <aside className="inspector">
          <div className="inspector-head"><strong>About this guide</strong><div className="muted" style={{ fontSize: 13 }}>Free to reuse with credit.</div></div>
          <div className="inspector-body">
            <div className="field"><label>Reading time</label><div>{String(data.item.read_minutes)} min</div></div>
            <div className="field"><label>Published</label><div>{fmtDate(data.item.created_at)}</div></div>
            <div className="field"><label>Status</label><div><span className="pill p-active">Live</span></div></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Submit({ me }: { me: ReturnType<typeof useMe> }) {
  const [msg, setMsg] = useState("");
  const [token, setToken] = useState("");
  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const { status, data } = await postJSON("/api/knowledge", { title: fd.get("title"), summary: fd.get("summary"), body_md: fd.get("body"), turnstile: token || undefined });
    setMsg(String(data.message ?? data.error ?? ""));
    if (status === 201) e.currentTarget.reset();
  }
  return (
    <div className="reveal" style={{ maxWidth: 720 }}>
      <div className="page-head"><div><h1 className="display">Share something free.</h1><p>Guides go live after a quick human review.</p></div></div>
      <SignInGate user={me.user} loading={me.loading}>
        <div className="card">
          {msg && <p role="status">{msg}</p>}
          <form onSubmit={(e) => void send(e)}>
            <div className="field"><label>Title</label><input name="title" placeholder="A clear, plain title" required /></div>
            <div className="field" style={{ marginTop: 12 }}><label>Summary</label><textarea name="summary" placeholder="One or two sentences on what it gives" /></div>
            <div className="field" style={{ marginTop: 12 }}><label>Body</label><textarea name="body" rows={8} placeholder="Write the guide in plain words" /></div>
            <Turnstile onToken={setToken} />
            <div style={{ marginTop: 12 }}><button className="btn btn-primary" type="submit">Send for review</button></div>
          </form>
        </div>
      </SignInGate>
    </div>
  );
}

async function uploadFile(file: File, bucket: "media" | "downloads"): Promise<{ key: string; size: number }> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`/api/uploads?bucket=${bucket}`, { method: "POST", body: fd });
  const data = (await r.json()) as { key?: string; size?: number; error?: string };
  if (!r.ok || !data.key) throw new Error(data.error ?? "Upload failed.");
  return { key: data.key, size: data.size ?? file.size };
}

function SoftwareList({ me }: { me: ReturnType<typeof useMe> }) {
  const { data, loading, error } = useApi<{ items: Item[] }>("/api/software");
  const [msg, setMsg] = useState("");
  const [token, setToken] = useState("");
  const [fq, setFq] = useState("");
  const [fos, setFos] = useState("all");
  const items = (data?.items ?? []).filter((s) =>
    (!fq || String(s.title).toLowerCase().includes(fq.toLowerCase())) && (fos === "all" || String(s.os) === fos || String(s.os) === "multi"));
  const pg = usePager(items);
  async function list(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      let r2_key = "";
      let size = 0;
      const f = fd.get("binary");
      if (f instanceof File && f.size > 0) ({ key: r2_key, size } = await uploadFile(f, "downloads"));
      const { status, data: d } = await postJSON("/api/software", { title: fd.get("title"), summary: fd.get("summary"), os: fd.get("os"), r2_key: r2_key || undefined, version: fd.get("version") || undefined, size, turnstile: token || undefined });
      setMsg(String(d.message ?? d.error ?? ""));
      if (status === 201) e.currentTarget.reset();
    } catch (err) { setMsg(err instanceof Error ? err.message : "Listing failed."); }
  }
  return (
    <div className="reveal">
      <div className="page-head"><div><h1 className="display">Software.</h1><p>Versioned free downloads with checksums on request.</p></div></div>
      <div className="stat-grid stagger" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <Stat label="Entries live" value={String(data?.items.length ?? 0)} loading={loading} />
        <Stat label="With binary" value={String((data?.items ?? []).filter((s) => s.version).length)} loading={loading} />
      </div>
      <div className="filters">
        <input type="search" placeholder="Search software…" value={fq} onChange={(e) => setFq(e.target.value)} aria-label="Search software" />
        <select value={fos} onChange={(e) => setFos(e.target.value)} aria-label="Filter by platform">
          <option value="all">All platforms</option><option value="windows">Windows</option><option value="mac">Mac</option><option value="linux">Linux</option><option value="android">Android</option><option value="web">Web</option><option value="multi">Multi</option>
        </select>
      </div>
      {error && <div className="notice">Software list failed ({error}).</div>}
      {!loading && !items.length && <div className="notice"><strong>{fq || fos !== "all" ? "Nothing matches those filters." : "No software yet."}</strong><p>Publish a free tool below — it appears after review.</p></div>}
      {!!items.length && (
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Platform</th><th>License</th><th>Version</th><th></th></tr></thead><tbody>
          {pg.slice.map((s) => (
            <tr key={String(s.id)}><td><strong>{String(s.title)}</strong><div className="muted" style={{ fontSize: 13 }}>{String(s.summary ?? "")}</div></td><td>{String(s.os)}</td><td>{String(s.license)}</td><td>{s.version ? `v${s.version}` : <span className="pill p-draft">No binary</span>}</td><td>{s.version ? <a className="linkbtn" href={`/api/software/${s.slug}/download`}>Download</a> : ""}</td></tr>
          ))}
        </tbody></table></div>
      )}
      {pg.pages > 1 && <div className="pager"><span>Showing {pg.slice.length} of {pg.total}</span><nav>{Array.from({ length: pg.pages }, (_, i) => i + 1).map((p) => <button key={p} className={`pagebtn${p === pg.cur ? " cur" : ""}`} onClick={() => pg.setPage(p)}>{p}</button>)}</nav></div>}
      <div className="sec-head"><h2>List a free tool</h2></div>
      <SignInGate user={me.user} loading={me.loading}>
        <div className="card">
          {msg && <p role="status">{msg}</p>}
          <form onSubmit={(e) => void list(e)}>
            <div className="field"><label>Name</label><input name="title" placeholder="Tool name" required /></div>
            <div className="field" style={{ marginTop: 12 }}><label>What it does</label><textarea name="summary" placeholder="One honest sentence" /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div className="field"><label>Platform</label><select name="os" defaultValue="multi"><option value="windows">Windows</option><option value="mac">Mac</option><option value="linux">Linux</option><option value="android">Android</option><option value="web">Web</option><option value="multi">Multi</option></select></div>
              <div className="field"><label>Version</label><input name="version" placeholder="1.0" /></div>
            </div>
            <div className="field" style={{ marginTop: 12 }}><label>Binary (up to 25 MB)</label><input name="binary" type="file" /></div>
            <Turnstile onToken={setToken} />
            <div style={{ marginTop: 12 }}><button className="btn btn-primary" type="submit">Send for review</button></div>
          </form>
        </div>
      </SignInGate>
    </div>
  );
}

function FilesList({ me }: { me: ReturnType<typeof useMe> }) {
  const { data, loading, error } = useApi<{ items: Item[] }>("/api/files");
  const [msg, setMsg] = useState("");
  const [token, setToken] = useState("");
  const [fq, setFq] = useState("");
  const items = (data?.items ?? []).filter((f) => !fq || String(f.title).toLowerCase().includes(fq.toLowerCase()));
  const pg = usePager(items);
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const f = fd.get("file");
      if (!(f instanceof File) || f.size === 0) { setMsg("Attach a file first."); return; }
      const { key, size } = await uploadFile(f, "media");
      const { status, data: d } = await postJSON("/api/files", { title: fd.get("title"), kind: f.name.split(".").pop() || "other", r2_key: key, size, turnstile: token || undefined });
      setMsg(String(d.message ?? d.error ?? ""));
      if (status === 201) e.currentTarget.reset();
    } catch (err) { setMsg(err instanceof Error ? err.message : "Upload failed."); }
  }
  return (
    <div className="reveal">
      <div className="page-head"><div><h1 className="display">File library.</h1><p>Documents, datasets and templates — a reusable ledger.</p></div></div>
      <div className="stat-grid stagger" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <Stat label="Files live" value={String(data?.items.length ?? 0)} loading={loading} />
        <Stat label="Total bytes" value={String((data?.items ?? []).reduce((n, f) => n + Number(f.size_bytes ?? 0), 0))} loading={loading} />
      </div>
      <div className="filters"><input type="search" placeholder="Search files…" value={fq} onChange={(e) => setFq(e.target.value)} aria-label="Search files" /></div>
      {error && <div className="notice">Library failed ({error}).</div>}
      {!loading && !items.length && <div className="notice"><strong>{fq ? "No files match that search." : "The shelves are empty."}</strong><p>Upload a file below to start the library.</p></div>}
      {!!items.length && (
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>License</th><th></th></tr></thead><tbody>
          {pg.slice.map((f) => <tr key={String(f.id)}><td><strong>{String(f.title)}</strong></td><td className="muted">{String(f.kind)}</td><td className="muted">{String(f.size_bytes)}</td><td><span className="pill p-pending">{String(f.license)}</span></td><td><a className="linkbtn" href={`/api/files/${f.id}/download`}>Download</a></td></tr>)}
        </tbody></table></div>
      )}
      {pg.pages > 1 && <div className="pager"><span>Showing {pg.slice.length} of {pg.total}</span><nav>{Array.from({ length: pg.pages }, (_, i) => i + 1).map((p) => <button key={p} className={`pagebtn${p === pg.cur ? " cur" : ""}`} onClick={() => pg.setPage(p)}>{p}</button>)}</nav></div>}
      <div className="sec-head"><h2>Add a file</h2></div>
      <SignInGate user={me.user} loading={me.loading}>
        <div className="card">
          {msg && <p role="status">{msg}</p>}
          <form onSubmit={(e) => void add(e)}>
            <div className="field"><label>Title</label><input name="title" placeholder="What is this file?" required /></div>
            <div className="field" style={{ marginTop: 12 }}><label>File (up to 25 MB)</label><input name="file" type="file" required /></div>
            <Turnstile onToken={setToken} />
            <div style={{ marginTop: 12 }}><button className="btn btn-primary" type="submit">Send for review</button></div>
          </form>
        </div>
      </SignInGate>
    </div>
  );
}

function ServicesList({ me }: { me: ReturnType<typeof useMe> }) {
  const { data, loading } = useApi<{ items: Item[] }>("/api/services");
  const [msg, setMsg] = useState("");
  const [token, setToken] = useState("");
  async function request(id: string, form: HTMLFormElement) {
    const fd = new FormData(form);
    const { data: d } = await postJSON(`/api/services/${id}/request`, { name: fd.get("name"), contact: fd.get("contact"), note: fd.get("note"), turnstile: token || undefined });
    setMsg(String(d.message ?? d.error ?? ""));
    form.reset();
  }
  async function offer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const { status, data: d } = await postJSON("/api/services", { title: fd.get("title"), place: fd.get("place"), slots: Number(fd.get("slots") || 1), turnstile: token || undefined });
    setMsg(String(d.message ?? d.error ?? ""));
    if (status === 201) e.currentTarget.reset();
  }
  return (
    <div className="reveal">
      <div className="page-head"><div><h1 className="display">Free help.</h1><p>Need → match → confirm. No payment, ever.</p></div></div>
      {loading && <p className="muted">Loading services…</p>}
      {msg && <p role="status">{msg}</p>}
      <div className="stat-grid stagger" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <Stat label="Offers live" value={String(data?.items.length ?? 0)} loading={loading} />
        <Stat label="Open slots" value={String((data?.items ?? []).reduce((n, s) => n + Number(s.slots ?? 0), 0))} loading={loading} />
      </div>
      {(data?.items ?? []).map((s) => (
        <div className="card card-lift" key={String(s.id)}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div><strong>{String(s.title)}</strong><div className="muted" style={{ fontSize: 13 }}>{String(s.place)} · {String(s.slots)} slots</div></div>
            <span className="pill p-active">Open</span>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void request(String(s.id), e.currentTarget); }} style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Your name</label><input name="name" placeholder="Your Name" required /></div>
            <div className="field"><label>Contact</label><input name="contact" placeholder="you@example.com or phone" required /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label>What do you need?</label><textarea name="note" placeholder="A sentence about your situation" /></div>
            <div style={{ gridColumn: "1 / -1" }}><Turnstile onToken={setToken} /><button className="btn btn-primary" type="submit">Request this help</button></div>
          </form>
        </div>
      ))}
      {!loading && !data?.items.length && <div className="notice"><strong>No offers right now.</strong><p>Check back soon, or offer a skill yourself below.</p></div>}
      <div className="sec-head"><h2>Offer help</h2></div>
      <SignInGate user={me.user} loading={me.loading}>
        <div className="card">
          <form onSubmit={(e) => void offer(e)}>
            <div className="field"><label>What help?</label><input name="title" placeholder="e.g. Weekend tutoring, bike repairs" required /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div className="field"><label>Where?</label><input name="place" placeholder="remote or a place" /></div>
              <div className="field"><label>How many people?</label><input name="slots" type="number" min={1} defaultValue={1} /></div>
            </div>
            <div style={{ marginTop: 12 }}><button className="btn btn-primary" type="submit">Offer for review</button></div>
          </form>
        </div>
      </SignInGate>
    </div>
  );
}

function SocialList({ me }: { me: ReturnType<typeof useMe> }) {
  const { data, loading } = useApi<{ items: Item[] }>("/api/events");
  const [msg, setMsg] = useState("");
  const [token, setToken] = useState("");
  const [present, setPresent] = useState<number | null>(null);
  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/room/lobby/ws?name=visitor`);
    ws.onmessage = (ev) => { try { const d = JSON.parse(ev.data); if (d.present != null) setPresent(d.present); } catch { /* ignore */ } };
    return () => ws.close();
  }, []);
  async function rsvp(id: string, form: HTMLFormElement) {
    const fd = new FormData(form);
    const { data: d } = await postJSON(`/api/events/${id}/rsvp`, { name: fd.get("name"), contact: fd.get("contact") });
    setMsg(String(d.message ?? d.error ?? ""));
    form.reset();
  }
  async function propose(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const when = new Date(String(fd.get("when") ?? ""));
    if (Number.isNaN(when.getTime())) { setMsg("Pick a date and time for the gathering."); return; }
    const { status, data: d } = await postJSON("/api/events", { title: fd.get("title"), place: fd.get("place"), starts_at: Math.floor(when.getTime() / 1000), capacity: Number(fd.get("capacity") || 20), turnstile: token || undefined });
    setMsg(String(d.message ?? d.error ?? ""));
    if (status === 201) e.currentTarget.reset();
  }
  const events = data?.items ?? [];
  return (
    <div className="reveal">
      <div className="page-head"><div><h1 className="display">Gatherings.</h1><p>{present != null ? `${present} neighbours browsing now.` : "Volunteer meetups and shared work."}</p></div></div>
      {loading && <p className="muted">Loading gatherings…</p>}
      {msg && <p role="status">{msg}</p>}
      <div className="stat-grid stagger" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <Stat label="Gatherings upcoming" value={String(events.length)} loading={loading} />
        <Stat label="Total capacity" value={String(events.reduce((n, v) => n + Number(v.capacity ?? 0), 0))} loading={loading} />
      </div>
      {!!events.length && (
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Gathering</th><th>Place</th><th>Date</th><th></th></tr></thead><tbody>
          {events.map((v) => (
            <tr key={String(v.id)}>
              <td><strong>{String(v.title)}</strong></td><td>{String(v.place)}</td><td>{fmtDate(v.starts_at)}</td>
              <td><form onSubmit={(ev) => { ev.preventDefault(); void rsvp(String(v.id), ev.currentTarget); }} style={{ display: "flex", gap: 6 }}><input name="name" placeholder="Your Name" required aria-label="Your name" style={{ width: 130 }} /><button className="btn btn-sm" type="submit">Join</button></form></td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {!loading && !events.length && <div className="notice"><strong>Nothing scheduled.</strong><p>Propose a cleanup, study circle or repair café below.</p></div>}
      <div className="sec-head"><h2>Propose a gathering</h2></div>
      <SignInGate user={me.user} loading={me.loading}>
        <div className="card">
          <form onSubmit={(e) => void propose(e)}>
            <div className="field"><label>Title</label><input name="title" placeholder="e.g. Riverside cleanup morning" required /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
              <div className="field"><label>Where?</label><input name="place" placeholder="A place or remote" /></div>
              <div className="field"><label>When?</label><input name="when" type="datetime-local" required /></div>
              <div className="field"><label>Capacity</label><input name="capacity" type="number" min={1} defaultValue={20} /></div>
            </div>
            <Turnstile onToken={setToken} />
            <div style={{ marginTop: 12 }}><button className="btn btn-primary" type="submit">Propose for review</button></div>
          </form>
        </div>
      </SignInGate>
    </div>
  );
}

function Moderate({ me }: { me: ReturnType<typeof useMe> }) {
  const [tick, setTick] = useState(0);
  const { data, error, loading } = useApi<{ pending: Record<string, Item[]> }>(me.user ? `/api/moderate/pending?t=${tick}` : null);
  const [msg, setMsg] = useState("");
  async function decide(kind: string, id: string, approve: boolean) {
    const { data: d } = await postJSON(`/api/moderate/${kind}/${id}`, { approve });
    setMsg(String(d.status ? `${kind} ${id}: ${d.status}` : d.error));
    setTick((t) => t + 1);
  }
  if (me.loading || loading) return <p className="muted">Loading the review queue…</p>;
  if (!me.user) return <div className="notice"><strong>Sign in first.</strong><p><Link to="/signin">Sign in</Link> to review the queue.</p></div>;
  if (error) return <div className="notice"><strong>Moderators only.</strong><p>{["admin", "moderator"].includes(me.user.role) ? error : "Your account is not a moderator account."}</p></div>;
  const kinds = Object.entries(data?.pending ?? {});
  const total = kinds.reduce((n, [, v]) => n + v.length, 0);
  return (
    <div className="reveal">
      <div className="page-head"><div><h1 className="display">Review queue.</h1><p>{total === 0 ? "All clear — nothing waiting." : `${total} items waiting for a human decision.`}</p></div></div>
      {msg && <p role="status">{msg}</p>}
      {!!total && (
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Item</th><th>Hub</th><th>Submitted</th><th></th></tr></thead><tbody>
          {kinds.flatMap(([table, items]) => items.map((it) => {
            const kind = table === "knowledge_posts" ? "knowledge" : table === "software_items" ? "software" : table === "library_files" ? "files" : table === "services" ? "services" : "events";
            return (
              <tr key={String(it.id)}>
                <td><strong>{String(it.title)}</strong><div className="muted" style={{ fontSize: 13 }}>{String(it.summary ?? it.place ?? it.body_md ?? "").slice(0, 120)}</div></td>
                <td><span className="pill p-pending">{kind}</span></td><td>{fmtDate(it.created_at)}</td>
                <td><div className="row-actions"><button className="btn btn-sm btn-primary" onClick={() => void decide(kind, String(it.id), true)}>Approve</button><button className="btn btn-sm" onClick={() => void decide(kind, String(it.id), false)}>Reject</button></div></td>
              </tr>
            );
          }))}
        </tbody></table></div>
      )}
    </div>
  );
}

export default function App() {
  const me = useMe();
  return <Shell me={me}><Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/signin" element={<SignIn me={me} />} />
    <Route path="/search" element={<SearchPage />} />
    <Route path="/knowledge" element={<KnowledgeList />} />
    <Route path="/knowledge/:slug" element={<KnowledgeDetail />} />
    <Route path="/software" element={<SoftwareList me={me} />} />
    <Route path="/files" element={<FilesList me={me} />} />
    <Route path="/services" element={<ServicesList me={me} />} />
    <Route path="/social" element={<SocialList me={me} />} />
    <Route path="/submit" element={<Submit me={me} />} />
    <Route path="/moderate" element={<Moderate me={me} />} />
    <Route path="*" element={<div className="notice">That page does not exist. <Link to="/">Back home</Link></div>} />
  </Routes></Shell>;
}
