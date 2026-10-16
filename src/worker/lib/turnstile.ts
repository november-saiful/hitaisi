import type { Env } from "../env";

// Returns true when the token verifies. When no secret is configured
// (pre-launch), it logs a warning and allows the request so local dev
// and review keeps working. Set TURNSTILE_SECRET via
// `wrangler secret put TURNSTILE_SECRET` before public launch.
export async function verifyTurnstile(
  env: Env,
  token: string | undefined,
  ip: string | null
): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) {
    console.warn(JSON.stringify({ msg: "turnstile_skipped_no_secret" }));
    return true;
  }
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = (await r.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error(JSON.stringify({ msg: "turnstile_verify_error", err: String(err) }));
    return false;
  }
}
