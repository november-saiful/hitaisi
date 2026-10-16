import { Hono } from "hono";
import type { Env } from "./env";
import { SocialRoom } from "./do/SocialRoom";
import { getUser, getCookie, sessionCookie, isValidEmail, displayNameFor } from "./lib/auth";
import { verifyTurnstile } from "./lib/turnstile";

export { SocialRoom };

type Bindings = { Bindings: Env };
const app = new Hono<Bindings>();

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "private, no-store" } });

function rid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

async function enqueue(c: { env: Env; executionCtx: { waitUntil(promise: Promise<unknown>): void } }, kind: string, id: string): Promise<void> {
  c.executionCtx.waitUntil(
    c.env.MODERATION_QUEUE.send({ kind, id }).catch((e) =>
      console.error(JSON.stringify({ msg: "queue_send_failed", err: String(e) }))
    )
  );
}

// Public config for the SPA (site key only — never secrets).
app.get("/api/config", (c) => json({ turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? "" }));

// Health — real status, no invented metrics.
app.get("/api/health", (c) => json({ ok: true, env: c.env.ENVIRONMENT }));

// ---- Auth (magic link; sessions in D1, token in KV) ----
app.post("/api/auth/request", async (c) => {
  let body: { email?: string };
  try { body = await c.req.json(); } catch { return json({ error: "Send a JSON body with your email." }, 400); }
  const email = (body.email ?? "").trim().toLowerCase().slice(0, 160);
  if (!isValidEmail(email)) return json({ error: "That email does not look right." }, 400);
  const token = crypto.randomUUID();
  await c.env.CACHE.put(`magic:${token}`, email, { expirationTtl: 900 });
  const link = `${new URL(c.req.url).origin}/api/auth/verify?token=${token}`;
  let emailed = false;
  try {
    await c.env.EMAIL.send({
      to: email,
      from: { email: `hello@${new URL(c.req.url).hostname}`, name: c.env.SITE_NAME },
      subject: `Sign in to ${c.env.SITE_NAME}`,
      text: `Click to sign in (valid 15 minutes): ${link}`,
      html: `<p>Click to sign in (valid 15 minutes): <a href="${link}">${link}</a></p>`,
    });
    emailed = true;
  } catch (err) {
    console.error(JSON.stringify({ msg: "magic_email_failed", err: String(err) }));
  }
  // Until a sending domain is onboarded, surface the link in non-production
  // so sign-in stays testable. Never in production.
  if (!emailed && c.env.ENVIRONMENT !== "production") {
    return json({ message: "Email is not configured yet — use this sign-in link (dev only).", devLink: link });
  }
  return json({ message: emailed ? "Check your inbox for the sign-in link." : "Sign-in email is unavailable right now. Try again later." });
});

app.get("/api/auth/verify", async (c) => {
  const token = (c.req.query("token") ?? "").slice(0, 64);
  if (!token) return json({ error: "That link is missing its token." }, 400);
  const email = await c.env.CACHE.get(`magic:${token}`);
  if (!email) return json({ error: "That link expired or was already used. Request a fresh one." }, 400);
  await c.env.CACHE.delete(`magic:${token}`);
  let user = await c.env.DB.prepare("SELECT id, email, display_name, role FROM users WHERE email=?1 LIMIT 1")
    .bind(email).first<{ id: string; email: string; display_name: string; role: string }>();
  if (!user) {
    const id = rid("u");
    await c.env.DB.prepare("INSERT INTO users (id, email, display_name, role) VALUES (?1, ?2, ?3, 'member')")
      .bind(id, email, displayNameFor(email)).run();
    user = { id, email, display_name: displayNameFor(email), role: "member" };
  }
  const sid = crypto.randomUUID();
  const expires = Math.floor(Date.now() / 1000) + 30 * 86400;
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(sid, user.id, expires).run();
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": sessionCookie(c, sid, 30 * 86400) },
  });
});

app.get("/api/me", async (c) => {
  const user = await getUser(c);
  if (!user) return json({ user: null }, 401);
  return json({ user });
});

app.post("/api/auth/logout", async (c) => {
  const sid = getCookie(c, "session");
  if (sid) await c.env.DB.prepare("DELETE FROM sessions WHERE id=?1").bind(sid).run();
  return new Response(JSON.stringify({ message: "Signed out." }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      "Set-Cookie": sessionCookie(c, "", 0),
    },
  });
});

// ---- Global search (D1 LIKE; vectors indexed by queue for semantic next step) ----
app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 120);
  if (!q) return json({ items: [] });
  const like = `%${q}%`;
  try {
    const [k, s, f, sv] = await Promise.all([
      c.env.DB.prepare(
        "SELECT id, title, summary, 'knowledge' AS hub, slug AS ref FROM knowledge_posts WHERE status='approved' AND (title LIKE ?1 OR summary LIKE ?1) ORDER BY created_at DESC LIMIT 10"
      ).bind(like).all(),
      c.env.DB.prepare(
        "SELECT id, title, summary, 'software' AS hub, slug AS ref FROM software_items WHERE status='approved' AND (title LIKE ?1 OR summary LIKE ?1) ORDER BY created_at DESC LIMIT 10"
      ).bind(like).all(),
      c.env.DB.prepare(
        "SELECT id, title, kind AS summary, 'files' AS hub, id AS ref FROM library_files WHERE status='approved' AND title LIKE ?1 ORDER BY created_at DESC LIMIT 10"
      ).bind(like).all(),
      c.env.DB.prepare(
        "SELECT id, title, place AS summary, 'services' AS hub, id AS ref FROM services WHERE status='approved' AND title LIKE ?1 ORDER BY created_at DESC LIMIT 10"
      ).bind(like).all(),
    ]);
    return json({ items: [...(k.results ?? []), ...(s.results ?? []), ...(f.results ?? []), ...(sv.results ?? [])].slice(0, 24) });
  } catch (err) {
    console.error(JSON.stringify({ msg: "search_failed", err: String(err) }));
    return json({ error: "Search is temporarily unavailable. Try again shortly." }, 500);
  }
});

// ---- Knowledge ----
app.get("/api/knowledge", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, title, slug, summary, read_minutes, created_at FROM knowledge_posts WHERE status='approved' ORDER BY created_at DESC LIMIT 50"
  ).all();
  return json({ items: rows.results ?? [] });
});
app.get("/api/knowledge/:slug", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT id, title, slug, summary, body_md, read_minutes, created_at FROM knowledge_posts WHERE slug=?1 AND status='approved' LIMIT 1"
  ).bind(c.req.param("slug")).first();
  if (!row) return json({ error: "That guide does not exist or is awaiting review." }, 404);
  return json({ item: row });
});
app.post("/api/knowledge", async (c) => {
  const user = await getUser(c);
  if (!user) return json({ error: "Sign in to share a guide." }, 401);
  let body: { title?: string; summary?: string; body_md?: string; turnstile?: string };
  try { body = await c.req.json(); } catch { return json({ error: "Send a JSON body with title, summary and body_md." }, 400); }
  if (!(await verifyTurnstile(c.env, body.turnstile, c.req.header("cf-connecting-ip") ?? null))) {
    return json({ error: "Bot check failed. Try again." }, 403);
  }
  const title = (body.title ?? "").trim().slice(0, 160);
  if (title.length < 4) return json({ error: "Give your guide a title of at least 4 characters." }, 400);
  const id = rid("kn");
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)}-${id.slice(-6)}`;
  await c.env.DB.prepare(
    "INSERT INTO knowledge_posts (id, author_id, title, slug, summary, body_md, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')"
  ).bind(id, user.id, title, slug, (body.summary ?? "").slice(0, 500), (body.body_md ?? "").slice(0, 60000)).run();
  await enqueue(c, "knowledge", id);
  return json({ id, slug, state: "pending", message: "Received. A moderator reviews it before it goes public." }, 201);
});

// ---- Uploads (signed-in only, 25 MB cap, streams to R2) ----
const MAX_UPLOAD = 25 * 1024 * 1024;
app.post("/api/uploads", async (c) => {
  const user = await getUser(c);
  if (!user) return json({ error: "Sign in to upload." }, 401);
  const bucket = c.req.query("bucket") === "downloads" ? "downloads" : "media";
  let form: FormData;
  try { form = await c.req.formData(); } catch { return json({ error: "Send a multipart form with a file field." }, 400); }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return json({ error: "Attach a file first." }, 400);
  if (file.size > MAX_UPLOAD) return json({ error: "That file is over the 25 MB limit." }, 413);
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "upload";
  const key = `uploads/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safe}`;
  const target = bucket === "downloads" ? c.env.DOWNLOADS : c.env.MEDIA;
  await target.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  return json({ key, size: file.size, bucket }, 201);
});

// ---- Software ----
app.get("/api/software", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT s.id, s.title, s.slug, s.summary, s.os, s.license, v.version, v.size_bytes FROM software_items s LEFT JOIN software_versions v ON v.software_id=s.id WHERE s.status='approved' ORDER BY s.created_at DESC LIMIT 50"
  ).all();
  return json({ items: rows.results ?? [] });
});
app.post("/api/software", async (c) => {
  const user = await getUser(c);
  if (!user) return json({ error: "Sign in to list software." }, 401);
  let body: { title?: string; summary?: string; os?: string; r2_key?: string; version?: string; size?: number; sha256?: string; turnstile?: string };
  try { body = await c.req.json(); } catch { return json({ error: "Send a JSON body with at least a title." }, 400); }
  if (!(await verifyTurnstile(c.env, body.turnstile, c.req.header("cf-connecting-ip") ?? null))) {
    return json({ error: "Bot check failed. Try again." }, 403);
  }
  const title = (body.title ?? "").trim().slice(0, 120);
  if (title.length < 3) return json({ error: "Name the software (3+ characters)." }, 400);
  const id = rid("sw");
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${id.slice(-6)}`;
  await c.env.DB.prepare(
    "INSERT INTO software_items (id, author_id, title, slug, summary, os, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')"
  ).bind(id, user.id, title, slug, (body.summary ?? "").slice(0, 500), (body.os ?? "multi").slice(0, 16)).run();
  if (body.r2_key) {
    await c.env.DB.prepare(
      "INSERT INTO software_versions (id, software_id, version, r2_key, size_bytes, sha256) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    ).bind(rid("sv"), id, (body.version ?? "1.0").slice(0, 32), body.r2_key.slice(0, 300), body.size ?? 0, (body.sha256 ?? "").slice(0, 128)).run();
  }
  await enqueue(c, "software", id);
  return json({ id, slug, state: "pending", message: "Listed for review. It appears publicly after approval." }, 201);
});
app.get("/api/software/:slug/download", async (c) => {
  const item = await c.env.DB.prepare(
    "SELECT id FROM software_items WHERE slug=?1 AND status='approved' LIMIT 1"
  ).bind(c.req.param("slug")).first<{ id: string }>();
  if (!item) return json({ error: "That software is missing or awaiting review." }, 404);
  const ver = await c.env.DB.prepare(
    "SELECT r2_key FROM software_versions WHERE software_id=?1 ORDER BY created_at DESC LIMIT 1"
  ).bind(item.id).first<{ r2_key: string }>();
  if (!ver) return json({ error: "No downloadable binary yet for this entry." }, 404);
  const obj = await c.env.DOWNLOADS.get(ver.r2_key);
  if (!obj) return json({ error: "The stored binary is gone. Report it and we will re-upload." }, 410);
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "content-length": String(obj.size),
      "cache-control": "public, max-age=3600",
    },
  });
});

// ---- Files ----
app.get("/api/files", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, title, kind, size_bytes, license, created_at FROM library_files WHERE status='approved' ORDER BY created_at DESC LIMIT 50"
  ).all();
  return json({ items: rows.results ?? [] });
});
app.post("/api/files", async (c) => {
  const user = await getUser(c);
  if (!user) return json({ error: "Sign in to add a file." }, 401);
  let body: { title?: string; kind?: string; r2_key?: string; size?: number; license?: string; turnstile?: string };
  try { body = await c.req.json(); } catch { return json({ error: "Upload the file first, then send its details." }, 400); }
  if (!(await verifyTurnstile(c.env, body.turnstile, c.req.header("cf-connecting-ip") ?? null))) {
    return json({ error: "Bot check failed. Try again." }, 403);
  }
  const title = (body.title ?? "").trim().slice(0, 160);
  if (title.length < 3 || !body.r2_key) return json({ error: "Give a title and upload the file first." }, 400);
  const id = rid("file");
  await c.env.DB.prepare(
    "INSERT INTO library_files (id, author_id, title, kind, r2_key, size_bytes, license, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending')"
  ).bind(id, user.id, title, (body.kind ?? "other").slice(0, 24), body.r2_key.slice(0, 300), body.size ?? 0, (body.license ?? "free").slice(0, 60)).run();
  await enqueue(c, "files", id);
  return json({ id, state: "pending", message: "Received. It appears after a quick review." }, 201);
});
app.get("/api/files/:id/download", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT r2_key FROM library_files WHERE id=?1 AND status='approved' LIMIT 1"
  ).bind(c.req.param("id")).first<{ r2_key: string }>();
  if (!row) return json({ error: "That file is missing or awaiting review." }, 404);
  const obj = await c.env.DOWNLOADS.get(row.r2_key);
  if (!obj) {
    const media = await c.env.MEDIA.get(row.r2_key);
    if (!media) return json({ error: "The stored file is gone. Report it and we will re-upload." }, 410);
    return new Response(media.body, {
      headers: {
        "content-type": media.httpMetadata?.contentType ?? "application/octet-stream",
        "content-length": String(media.size),
        "cache-control": "public, max-age=3600",
      },
    });
  }
  // Stream — never buffer unbounded bodies.
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "content-length": String(obj.size),
      "cache-control": "public, max-age=3600",
    },
  });
});

// ---- Services ----
app.get("/api/services", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, title, place, slots FROM services WHERE status='approved' ORDER BY created_at DESC LIMIT 50"
  ).all();
  return json({ items: rows.results ?? [] });
});
app.post("/api/services", async (c) => {
  const user = await getUser(c);
  if (!user) return json({ error: "Sign in to offer help." }, 401);
  let body: { title?: string; place?: string; slots?: number; turnstile?: string };
  try { body = await c.req.json(); } catch { return json({ error: "Send a JSON body with a title." }, 400); }
  if (!(await verifyTurnstile(c.env, body.turnstile, c.req.header("cf-connecting-ip") ?? null))) {
    return json({ error: "Bot check failed. Try again." }, 403);
  }
  const title = (body.title ?? "").trim().slice(0, 160);
  if (title.length < 4) return json({ error: "Describe the help in a few words (4+ characters)." }, 400);
  const id = rid("svc");
  await c.env.DB.prepare("INSERT INTO services (id, provider_id, title, place, slots, status) VALUES (?1, ?2, ?3, ?4, ?5, 'pending')")
    .bind(id, user.id, title, (body.place ?? "remote").slice(0, 120), Math.max(1, Math.min(500, body.slots ?? 1))).run();
  await enqueue(c, "services", id);
  return json({ id, state: "pending", message: "Offer received. It lists publicly after review." }, 201);
});
app.post("/api/services/:id/request", async (c) => {
  let body: { name?: string; contact?: string; note?: string; turnstile?: string };
  try { body = await c.req.json(); } catch { return json({ error: "Send name, contact and an optional note." }, 400); }
  if (!(await verifyTurnstile(c.env, body.turnstile, c.req.header("cf-connecting-ip") ?? null))) {
    return json({ error: "Bot check failed. Try again." }, 403);
  }
  const name = (body.name ?? "").trim().slice(0, 80);
  const contact = (body.contact ?? "").trim().slice(0, 120);
  if (name.length < 2 || !contact) return json({ error: "Add your name and a way to reach you." }, 400);
  const exists = await c.env.DB.prepare("SELECT id FROM services WHERE id=?1 AND status='approved' LIMIT 1").bind(c.req.param("id")).first();
  if (!exists) return json({ error: "That service is not available right now." }, 404);
  const id = rid("sr");
  await c.env.DB.prepare(
    "INSERT INTO service_requests (id, service_id, requester_name, requester_contact, note, state) VALUES (?1, ?2, ?3, ?4, ?5, 'new')"
  ).bind(id, c.req.param("id"), name, contact, (body.note ?? "").slice(0, 1000)).run();
  return json({ id, state: "new", message: "Request sent. The provider replies by your contact." }, 201);
});

// ---- Events / social ----
app.get("/api/events", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, title, place, starts_at, capacity FROM events WHERE status='approved' ORDER BY starts_at ASC LIMIT 50"
  ).all();
  return json({ items: rows.results ?? [] });
});
app.post("/api/events", async (c) => {
  const user = await getUser(c);
  if (!user) return json({ error: "Sign in to propose a gathering." }, 401);
  let body: { title?: string; place?: string; starts_at?: number; capacity?: number; turnstile?: string };
  try { body = await c.req.json(); } catch { return json({ error: "Send a JSON body with a title and start time." }, 400); }
  if (!(await verifyTurnstile(c.env, body.turnstile, c.req.header("cf-connecting-ip") ?? null))) {
    return json({ error: "Bot check failed. Try again." }, 403);
  }
  const title = (body.title ?? "").trim().slice(0, 160);
  if (title.length < 4 || !body.starts_at) return json({ error: "Add a title and a start time." }, 400);
  const id = rid("ev");
  await c.env.DB.prepare("INSERT INTO events (id, host_id, title, place, starts_at, capacity, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')")
    .bind(id, user.id, title, (body.place ?? "remote").slice(0, 120), Math.floor(body.starts_at), Math.max(1, Math.min(1000, body.capacity ?? 20))).run();
  await enqueue(c, "events", id);
  return json({ id, state: "pending", message: "Gathering proposed. It lists after review." }, 201);
});
app.post("/api/events/:id/rsvp", async (c) => {
  let body: { name?: string; contact?: string };
  try { body = await c.req.json(); } catch { return json({ error: "Send your name to join." }, 400); }
  const name = (body.name ?? "").trim().slice(0, 80);
  if (name.length < 2) return json({ error: "Add your name so the host knows who is coming." }, 400);
  try {
    await c.env.DB.prepare("INSERT INTO event_rsvps (id, event_id, name, contact) VALUES (?1, ?2, ?3, ?4)")
      .bind(rid("rsvp"), c.req.param("id"), name, (body.contact ?? "").slice(0, 120)).run();
  } catch {
    return json({ error: "You already joined with that contact — see you there." }, 409);
  }
  const stub = c.env.SOCIAL_ROOM.getByName(`event-${c.req.param("id")}`);
  c.executionCtx.waitUntil(stub.broadcastCount().catch(() => undefined));
  return json({ message: "You are on the list." }, 201);
});

// ---- Comments (approved only, per target) ----
app.get("/api/comments", async (c) => {
  const kind = (c.req.query("kind") ?? "").slice(0, 32);
  const target = (c.req.query("target") ?? "").slice(0, 64);
  if (!kind || !target) return json({ items: [] });
  const rows = await c.env.DB.prepare(
    "SELECT author_name, body, created_at FROM comments WHERE target_kind=?1 AND target_id=?2 AND status='approved' ORDER BY created_at DESC LIMIT 30"
  ).bind(kind, target).all();
  return json({ items: rows.results ?? [] });
});

// ---- Realtime room passthrough → Durable Object ----
app.all("/api/room/:name/*", async (c) => {
  const stub = c.env.SOCIAL_ROOM.getByName(c.req.param("name"));
  return stub.fetch(c.req.raw);
});

// ---- Moderation (moderators + admins only) ----
app.get("/api/moderate/pending", async (c) => {
  const user = await getUser(c);
  if (!user || (user.role !== "admin" && user.role !== "moderator")) {
    return json({ error: "Moderators only." }, 403);
  }
  const tables = ["knowledge_posts", "software_items", "library_files", "services", "events"] as const;
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const rows = await c.env.DB.prepare(`SELECT * FROM ${t} WHERE status='pending' ORDER BY created_at DESC LIMIT 50`).all();
    out[t] = rows.results ?? [];
  }
  return json({ pending: out });
});
app.post("/api/moderate/:kind/:id", async (c) => {
  const user = await getUser(c);
  if (!user || (user.role !== "admin" && user.role !== "moderator")) {
    return json({ error: "Moderators only." }, 403);
  }
  const kind = c.req.param("kind");
  const table = kind === "knowledge" ? "knowledge_posts" : kind === "software" ? "software_items" : kind === "files" ? "library_files" : kind === "services" ? "services" : kind === "events" ? "events" : null;
  if (!table) return json({ error: "Unknown queue item." }, 400);
  let body: { approve?: boolean };
  try { body = await c.req.json(); } catch { body = {}; }
  const status = body.approve === false ? "rejected" : "approved";
  await c.env.DB.prepare(`UPDATE ${table} SET status=?1 WHERE id=?2`).bind(status, c.req.param("id")).run();
  return json({ id: c.req.param("id"), status });
});

// ---- Queue: index new items into Vectorize for semantic search ----
async function indexItem(env: Env, kind: string, id: string): Promise<void> {
  const table = kind === "knowledge" ? "knowledge_posts" : kind === "software" ? "software_items" : kind === "files" ? "library_files" : kind === "services" ? "services" : kind === "events" ? "events" : null;
  if (!table) return;
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?1 LIMIT 1`).bind(id).first<Record<string, unknown>>();
  if (!row) return;
  const text = `${String(row.title ?? "")}\n${String(row.summary ?? row.place ?? "")}`.slice(0, 2000);
  if (!text.trim()) return;
  try {
    const emb = (await env.AI.run("@cf/baai/bge-base-en-v1.5", { text })) as { data?: number[][] };
    const values = emb.data?.[0];
    if (!values) return;
    await env.SEARCH_INDEX.upsert([{ id: `${kind}:${id}`, values, metadata: { kind, ref: String(row.slug ?? row.id) } }]);
  } catch (err) {
    console.error(JSON.stringify({ msg: "vector_index_failed", kind, id, err: String(err) }));
  }
}

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const body = msg.body as { kind?: string; id?: string } | null;
      try {
        if (body?.kind && body?.id) await indexItem(env, body.kind, body.id);
        msg.ack();
      } catch (err) {
        console.error(JSON.stringify({ msg: "queue_item_failed", err: String(err) }));
        msg.retry();
      }
    }
  },
};
