import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Route, Routes, useParams, Link, useNavigate, useSearchParams } from "react-router-dom";

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
    }).catch(() => { /* bot check unavailable — server still validates when configured */ });
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

function Shell({ me, children }: { me: ReturnType<typeof useMe>; children: ReactNode }) {
  const [theme, setTheme] = useState("light");
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    me.refresh();
    navigate("/");
  }
  return (
    <div className="wrap">
      <header className="topbar">
        <Link className="brand" to="/"><span className="brand-mark">H</span><strong>Hitaisi</strong></Link>
        <nav className="nav" aria-label="Hubs">
          <NavLink to="/knowledge">Knowledge</NavLink>
          <NavLink to="/software">Software</NavLink>
          <NavLink to="/files">Files</NavLink>
          <NavLink to="/services">Services</NavLink>
          <NavLink to="/social">Social</NavLink>
        </nav>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`); }} role="search">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the commons" aria-label="Search" style={{ width: 180 }} />
          </form>
          {me.user ? (
            <><span className="muted">{me.user.display_name}</span><button className="btn" onClick={() => void logout()}>Out</button></>
          ) : (
            <Link className="btn" to="/signin">Sign in</Link>
          )}
          <button className="btn" onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))} aria-label="Toggle theme">
            {theme === "light" ? "Dark" : "Light"}
          </button>
        </div>
      </header>
      <main>{children}</main>
      <footer className="muted" style={{ padding: "48px 0" }}>
        Free forever. Everything here is shared, not sold. <Link to="/submit">Share something</Link> — a moderator reviews it first.
      </footer>
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
  if (me.user) return <div className="notice"><strong>Signed in as {me.user.display_name}.</strong><p><Link to="/submit">Share something</Link>, or browse the hubs.</p></div>;
  return (
    <div className="reveal" style={{ maxWidth: 480 }}>
      <h1 className="display">Sign in with email.</h1>
      <p className="lede">No passwords. We send a 15-minute link.</p>
      {msg && <p role="status">{msg}</p>}
      {devLink && <p><Link to={devLink.replace(/^https?:\/\/[^/]+/, "")}>Use this sign-in link (dev only)</Link></p>}
      <form onSubmit={(e) => void send(e)}>
        <label>Email<input name="email" type="email" placeholder="you@example.com" required /></label>
        <button className="btn btn-primary" type="submit">Send the link</button>
      </form>
    </div>
  );
}

function Home() {
  return (
    <div className="reveal">
      <section className="hero">
        <h1 className="display">What was freely given this week.</h1>
        <p className="lede">Guides to read, software to download, files to reuse, neighbours offering help, and gatherings to join. No accounts needed to read — sign in only to share.</p>
        <div className="cta-row">
          <Link className="btn btn-primary" to="/knowledge">Read the guides <span className="dot">→</span></Link>
          <Link className="btn" to="/submit">Share something</Link>
        </div>
      </section>
      <section className="grid-hubs">
        {[
          ["/knowledge", "Knowledge", "Longform guides with chapters and sources."],
          ["/software", "Software", "Versioned downloads with checksums."],
          ["/files", "Files", "A ledger of reusable documents and data."],
          ["/services", "Services", "Free help: ask, match, confirm."],
          ["/social", "Social", "Volunteer feed and live gatherings."],
        ].map(([to, title, desc]) => (
          <Link key={to} className="hub-card" to={to}><small>{title}</small><h3 style={{ margin: "8px 0" }}>{title}</h3><p className="muted">{desc}</p></Link>
        ))}
      </section>
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
      <h1 className="display">Results for “{q}”.</h1>
      {loading && <p className="muted">Searching…</p>}
      {error && <div className="notice">Search failed ({error}).</div>}
      {data && !data.items.length && <div className="notice"><strong>Nothing found.</strong><p>Try fewer words, or be the first to share it.</p></div>}
      {data?.items.map((it, i) => (
        <div key={i} className="list-row"><div><small className="muted">{String(it.hub)}</small><br /><Link to={hubPath(it.hub, it.ref)}><strong>{String(it.title)}</strong></Link><div className="muted">{String(it.summary ?? "")}</div></div></div>
      ))}
    </div>
  );
}

function KnowledgeList() {
  const { data, error, loading } = useApi<{ items: Item[] }>("/api/knowledge");
  if (loading) return <p className="muted">Loading guides…</p>;
  if (error) return <div className="notice">Guides failed to load ({error}). Try again shortly.</div>;
  if (!data?.items.length) return <div className="notice"><strong>No guides yet.</strong><p>Be the first to share one — it goes live after a quick review.</p><Link className="btn btn-primary" to="/submit">Write a guide</Link></div>;
  return <div className="ribbon">{data.items.map((k) => (
    <article key={String(k.id)} className="list-row"><div><Link to={`/knowledge/${k.slug}`}><strong>{k.title}</strong></Link><div className="muted">{k.summary} · {k.read_minutes} min</div></div></article>
  ))}</div>;
}

function KnowledgeDetail() {
  const { slug } = useParams();
  const { data, error, loading } = useApi<{ item: Item }>(slug ? `/api/knowledge/${slug}` : null);
  if (loading) return <p className="muted">Opening the guide…</p>;
  if (error || !data) return <div className="notice">That guide is missing or awaiting review. <Link to="/knowledge">Back to guides</Link></div>;
  return <article className="reveal" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 32 }}><div><h1 className="display">{data.item.title}</h1><p className="lede">{data.item.summary}</p><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{data.item.body_md}</pre></div><aside><div className="notice"><strong>About this guide</strong><p className="muted">{data.item.read_minutes} min read · free to reuse with credit.</p></div></aside></article>;
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
    <div className="reveal">
      <h1 className="display">Share something free.</h1>
      <p className="lede">Guides go live after a quick human review.</p>
      <SignInGate user={me.user} loading={me.loading}>
        {msg && <p role="status">{msg}</p>}
        <form onSubmit={(e) => void send(e)}>
          <label>Title<input name="title" placeholder="A clear, plain title" required /></label>
          <label>Summary<textarea name="summary" placeholder="One or two sentences on what it gives" /></label>
          <label>Body<textarea name="body" rows={8} placeholder="Write the guide in plain words" /></label>
          <Turnstile onToken={setToken} />
          <button className="btn btn-primary" type="submit">Send for review</button>
        </form>
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
      <h1 className="display">Free software.</h1>
      {(loading && <p className="muted">Loading software…</p>) || null}
      {error && <div className="notice">Software list failed ({error}).</div>}
      {data && !data.items.length && <div className="notice"><strong>No software yet.</strong><p>Publish a free tool and it appears here after review.</p></div>}
      {data?.items.map((s) => (
        <div key={String(s.id)} className="list-row"><div><strong>{s.title}</strong> <span className="muted">{String(s.os)} · {String(s.license)}</span><div className="muted">{s.summary}</div></div><div>{s.version ? <a href={`/api/software/${s.slug}/download`}>v{String(s.version)} ↓</a> : <span className="muted">awaiting binary</span>}</div></div>
      ))}
      <h2 style={{ marginTop: 32 }}>List a free tool</h2>
      <SignInGate user={me.user} loading={me.loading}>
        {msg && <p role="status">{msg}</p>}
        <form onSubmit={(e) => void list(e)}>
          <label>Name<input name="title" placeholder="Tool name" required /></label>
          <label>What it does<textarea name="summary" placeholder="One honest sentence" /></label>
          <label>Platform<select name="os" defaultValue="multi"><option value="windows">Windows</option><option value="mac">Mac</option><option value="linux">Linux</option><option value="android">Android</option><option value="web">Web</option><option value="multi">Multi</option></select></label>
          <label>Version<input name="version" placeholder="1.0" /></label>
          <label>Binary (up to 25 MB)<input name="binary" type="file" /></label>
          <Turnstile onToken={setToken} />
          <button className="btn btn-primary" type="submit">Send for review</button>
        </form>
      </SignInGate>
    </div>
  );
}

function FilesList({ me }: { me: ReturnType<typeof useMe> }) {
  const { data, loading, error } = useApi<{ items: Item[] }>("/api/files");
  const [msg, setMsg] = useState("");
  const [token, setToken] = useState("");
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
      <h1 className="display">The file library.</h1>
      {loading && <p className="muted">Loading the library…</p>}
      {error && <div className="notice">Library failed ({error}).</div>}
      {data && !data.items.length && <div className="notice"><strong>The shelves are empty.</strong><p>Upload a PDF, dataset or template below to start the library.</p></div>}
      {!!data?.items.length && (
        <table className="table"><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>License</th><th></th></tr></thead><tbody>
          {data?.items.map((f) => <tr key={String(f.id)}><td>{f.title}</td><td className="muted">{f.kind}</td><td className="muted">{f.size_bytes}</td><td className="muted">{f.license}</td><td><a href={`/api/files/${f.id}/download`}>Download</a></td></tr>)}
        </tbody></table>
      )}
      <h2 style={{ marginTop: 32 }}>Add a file</h2>
      <SignInGate user={me.user} loading={me.loading}>
        {msg && <p role="status">{msg}</p>}
        <form onSubmit={(e) => void add(e)}>
          <label>Title<input name="title" placeholder="What is this file?" required /></label>
          <label>File (up to 25 MB)<input name="file" type="file" required /></label>
          <Turnstile onToken={setToken} />
          <button className="btn btn-primary" type="submit">Send for review</button>
        </form>
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
  if (loading) return <p className="muted">Loading services…</p>;
  return (
    <div>
      <h1 className="display">Free help.</h1>
      <div className="notice ribbon">Need → match → confirm. Tell us what you need; a volunteer confirms by your contact. No payment, ever.</div>
      {msg && <p role="status">{msg}</p>}
      {(data?.items ?? []).map((s) => (
        <div key={String(s.id)} className="hub-card" style={{ marginTop: 12 }}><strong>{s.title}</strong><div className="muted">{String(s.place)} · {String(s.slots)} slots</div>
          <form onSubmit={(e) => { e.preventDefault(); void request(String(s.id), e.currentTarget); }} style={{ marginTop: 12 }}>
            <label>Your Name<input name="name" placeholder="Your Name" required /></label>
            <label>Contact<input name="contact" placeholder="you@example.com or phone" required /></label>
            <label>What do you need?<textarea name="note" placeholder="A sentence about your situation" /></label>
            <Turnstile onToken={setToken} />
            <button className="btn btn-primary" type="submit">Request this help</button>
          </form></div>
      ))}
      {!data?.items.length && <div className="notice" style={{ marginTop: 12 }}><strong>No offers right now.</strong><p>Check back soon, or offer a skill yourself.</p></div>}
      <h2 style={{ marginTop: 32 }}>Offer help</h2>
      <SignInGate user={me.user} loading={me.loading}>
        <form onSubmit={(e) => void offer(e)}>
          <label>What help?<input name="title" placeholder="e.g. Weekend tutoring, bike repairs" required /></label>
          <label>Where?<input name="place" placeholder="remote or a place" /></label>
          <label>How many people?<input name="slots" type="number" min={1} defaultValue={1} /></label>
          <button className="btn btn-primary" type="submit">Offer for review</button>
        </form>
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
  if (loading) return <p className="muted">Loading gatherings…</p>;
  return (
    <div>
      <h1 className="display">Gatherings.</h1>
      {present != null && <p className="muted" role="status">{present} neighbours browsing now.</p>}
      {msg && <p role="status">{msg}</p>}
      {(data?.items ?? []).map((e) => (
        <div key={String(e.id)} className="hub-card" style={{ marginTop: 12 }}>
          <small>{new Date(Number(e.starts_at) * 1000).toLocaleString()} · {String(e.place)}</small>
          <h3 style={{ margin: "6px 0" }}>{e.title}</h3>
          <form onSubmit={(ev) => { ev.preventDefault(); void rsvp(String(e.id), ev.currentTarget); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <input name="name" placeholder="Your Name" required style={{ flex: "1 1 160px" }} />
            <input name="contact" placeholder="Contact (optional)" style={{ flex: "1 1 160px" }} />
            <button className="btn" type="submit">Join</button>
          </form>
        </div>
      ))}
      {!data?.items.length && <div className="notice"><strong>Nothing scheduled.</strong><p>Propose a cleanup, study circle or repair café below.</p></div>}
      <h2 style={{ marginTop: 32 }}>Propose a gathering</h2>
      <SignInGate user={me.user} loading={me.loading}>
        <form onSubmit={(e) => void propose(e)}>
          <label>Title<input name="title" placeholder="e.g. Riverside cleanup morning" required /></label>
          <label>Where?<input name="place" placeholder="A place or remote" /></label>
          <label>When?<input name="when" type="datetime-local" required /></label>
          <label>Capacity<input name="capacity" type="number" min={1} defaultValue={20} /></label>
          <Turnstile onToken={setToken} />
          <button className="btn btn-primary" type="submit">Propose for review</button>
        </form>
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
  if (!me.user) return <div className="notice"><strong>Sign in first.</strong></div>;
  if (error) return <div className="notice"><strong>Moderators only.</strong><p>{ ["admin", "moderator"].includes(me.user.role) ? error : "Your account is not a moderator account."}</p></div>;
  const kinds = Object.entries(data?.pending ?? {});
  const total = kinds.reduce((n, [, v]) => n + v.length, 0);
  return (
    <div className="reveal">
      <h1 className="display">Review queue.</h1>
      <p className="lede">{total === 0 ? "All clear — nothing waiting." : `${total} items waiting for a human decision.`}</p>
      {msg && <p role="status">{msg}</p>}
      {kinds.map(([table, items]) => items.map((it) => {
        const kind = table === "knowledge_posts" ? "knowledge" : table === "software_items" ? "software" : table === "library_files" ? "files" : table === "services" ? "services" : "events";
        return (
          <div key={String(it.id)} className="hub-card" style={{ marginTop: 12 }}>
            <small className="muted">{kind}</small>
            <h3 style={{ margin: "6px 0" }}>{String(it.title)}</h3>
            <p className="muted">{String(it.summary ?? it.place ?? it.body_md ?? "").slice(0, 300)}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={() => void decide(kind, String(it.id), true)}>Approve</button>
              <button className="btn" onClick={() => void decide(kind, String(it.id), false)}>Reject</button>
            </div>
          </div>
        );
      }))}
    </div>
  );
}

export default function App() {
  const me = useMe();
  return <Shell me={me}><Routes>
    <Route path="/" element={<Home />} />
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
