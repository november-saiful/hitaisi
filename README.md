# Hitaisi

Live: https://hitaisi.november-saiful.workers.dev

Free knowledge, software, files, volunteer help and gatherings. React Vite SPA served by a Hono Worker. Cloudflare-only backend: D1 + R2 + KV + Queues + Vectorize + Workers AI + Email Service + SocialRoom Durable Object.

## Local dev
1. `npm install`
2. `npm run cf:types` (generates `src/worker/env.d.ts` from `wrangler.jsonc` — do not hand-edit bindings)
3. `npm run db:migrate:local` then `wrangler dev` (Worker + SPA), and `npm run dev` for Vite HMR.
4. Create real resources before deploy: `wrangler d1 create benevolent-db`, `wrangler r2 bucket create benevolent-media`, `benevolent-downloads`, `wrangler kv namespace create CACHE`, `wrangler queues create moderation`, `wrangler vectorize create benevolent-search --preset @cf/baai/bge-base-en-v1.5`, enable Email Sending on your domain, then paste the IDs into `wrangler.jsonc`.

## Moderation
Open read; publishing goes to `pending`. Approve in the admin UI via `POST /api/moderate/:kind/:id {approve:true|false}`. Queue consumer handles thumbnails/embeddings/notify off-request via `ctx.waitUntil`.

## Before public launch
- `wrangler email sending enable yourdomain.com`, then set the FROM domain in `src/worker/index.ts` (currently uses the request hostname).
- Create a Turnstile widget (Cloudflare dashboard → Turnstile), then `wrangler secret put TURNSTILE_SECRET` and set `TURNSTILE_SITE_KEY` in `wrangler.jsonc`. Until then the bot check logs a warning and allows traffic.
- Promote your account: sign in once, then `wrangler d1 execute benevolent-db --remote --command "UPDATE users SET role='admin' WHERE email='you@example.com'"` so `/moderate` opens for you.

## Design
See `DESIGN.md`. Warm paper + ink + one moss accent, Fraunces display + Jakarta body, per-hub layouts, Giving Ribbon signature, no gradients/glass-dumps/bento/grids-without-reason, honest empty states, light/dark toggle, reduced-motion respected.
