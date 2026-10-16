import type { Context } from "hono";
import type { Env } from "../env";

export type User = {
  id: string;
  email: string;
  display_name: string;
  role: string;
};

export function getCookie(c: Context<{ Bindings: Env }>, name: string): string | null {
  const header = c.req.header("cookie") ?? "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function sessionCookie(c: Context<{ Bindings: Env }>, sessionId: string, maxAge: number): string {
  const secure = new URL(c.req.url).protocol === "https:" ? "; Secure" : "";
  return `session=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function getUser(c: Context<{ Bindings: Env }>): Promise<User | null> {
  const sid = getCookie(c, "session");
  if (!sid) return null;
  const sess = await c.env.DB.prepare(
    "SELECT user_id, expires_at FROM sessions WHERE id=?1 LIMIT 1"
  ).bind(sid).first<{ user_id: string; expires_at: number }>();
  if (!sess || sess.expires_at < Math.floor(Date.now() / 1000)) return null;
  const user = await c.env.DB.prepare(
    "SELECT id, email, display_name, role FROM users WHERE id=?1 LIMIT 1"
  ).bind(sess.user_id).first<User>();
  return user ?? null;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function displayNameFor(email: string): string {
  const local = email.split("@")[0] ?? "friend";
  const clean = local.replace(/[^a-zA-Z0-9 ._-]/g, "").slice(0, 40);
  return clean || "friend";
}
