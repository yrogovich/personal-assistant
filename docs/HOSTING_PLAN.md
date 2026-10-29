# Hosting plan: from "local on my Mac" to the cloud

> Status: **draft for review**. No code has changed. Written 2026-10-29.
> Goal: the morning plan, syncs and Claude access keep working while the laptop is closed.

## TL;DR: the recommended path

| Area | Recommendation |
|---|---|
| App + scheduler | **One always-on container on Fly.io** (Warsaw `waw`, or Frankfurt `fra`), `next start` from a Docker image. Keep the existing in-process scheduler. Exactly one machine, never auto-stopped. |
| Database | **Keep SQLite.** Put the same libsql file on a Fly volume (`DATABASE_URL=file:/data/app.db`). Daily volume snapshots plus a nightly `VACUUM INTO` copy to object storage. Turso is the fallback if we ever go serverless. Postgres isn't worth it. |
| Secrets | Fly secrets. Production **takes over** the current `APP_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` together with the database. The Mac gets new dev keys and its own dev database. |
| Domain / OAuth | Your own subdomain, e.g. `https://dash.example.com`. Add the production redirect URIs to the existing Google client. Point the Strava callback domain at it (localhost stays allowed for dev). |
| Claude | Serve the existing MCP tools over **streamable HTTP at `/api/mcp`** in the same Next app, behind **OAuth 2.1 from Better Auth's MCP/OAuth-provider plugin** (Google sign-in plus the allow-list). Add it as a **custom connector** in Claude. Move the 07:59 job from a Desktop scheduled task to a **cloud routine**, because Desktop tasks only run while the Mac is awake. |
| Apple Reminders | Add a push endpoint `POST /api/ingest/reminders`. An **iPhone Shortcut** pushes reminders a few times a day, and an optional `launchd` agent on the Mac reuses today's JXA script. |
| PWA / phone | `app/manifest.ts` + icons + a mobile pass on Today. No offline mode. Web push ("plan ready") later. |
| Cost | About **$5–8/month** for hosting. Claude stays on your subscription. Adding the API path costs about $3–5/month more. |

The rest of this document explains each choice, lists the code changes it needs (to be done after review), and ends with a migration order that keeps the Mac setup working until the switch.

---

## 0. Why the 07:59 task can't run with the laptop closed today

Three local dependencies:

1. **The MCP server is stdio.** Claude Desktop starts `scripts/mcp-server.sh` as a child process on the Mac. No Mac, no tools.
2. **The data is on the Mac.** `data/app.db` (about 400 KB today) holds the synced calendars, mail metadata, plans, logs and encrypted credentials.
3. **Desktop scheduled tasks run on the Mac.** Even with a remote MCP server, a Claude Desktop scheduled task only fires while the app is running and the computer is awake. A closed lid sleeps the Mac, and the run is skipped (Desktop catches up on wake). So the schedule itself has to move off the Mac too (§5.4).

---

## 1. Hosting the Next.js app and the scheduler

### What the app needs from a host

- A **long-lived Node process**. `src/instrumentation.ts` → `boot()` runs migrations and `startScheduler()`. That is a 20-second `setInterval` that syncs at :07/:22/:37/:52, makes the 06:30 plan and drafts the Sunday 18:00 review. It also keeps in-memory state (`__paPlanTried`, the `running` sync set) that assumes **one instance**.
- Outbound IMAP (993), CalDAV and HTTPS. Syncs can take tens of seconds (Notion rate limits, IMAP).
- A **persistent disk** if we keep SQLite as a file.
- Streaming responses (Server Actions, and SSE for MCP if we ever use it).

### Options

| Option | Fits the code as is? | Notes | Approx. cost |
|---|---|---|---|
| **A. Fly.io, 1 machine + volume** (recommended) | Yes. Scheduler, file DB and instrumentation all work unchanged | Docker deploy, regions next to Warsaw, volumes with daily snapshots, `fly secrets`, TLS and custom domains included. No free tier any more | shared-cpu-1x 1 GB ≈ $5–7 + 1 GB volume $0.15 |
| B. Railway / Render, 1 service + disk | Yes | Similar model with a nicer dashboard. Render's free tier sleeps (kills the scheduler), so a paid plan is needed. Fewer EU regions | $5–10 |
| C. Small VPS (e.g. Hetzner CX22) + Docker + Caddy | Yes | Cheapest for the specs and fully yours, but you patch the OS, set up TLS, backups and monitoring yourself | ≈ €4–5 |
| D. Vercel (serverless) + Vercel Cron + Turso | **No** | No persistent process: the scheduler becomes cron route handlers, the DB must be remote, and long IMAP/Notion syncs push against function time limits. Hobby cron runs at most daily, so 15-minute syncs need Pro ($20) or an external pinger | $0–20 |

**Recommendation: A (Fly.io).** It runs the current architecture unchanged: one process, scheduler included, SQLite on disk. That keeps the migration to configuration, not a rewrite. A VPS (C) is the fallback if you'd rather pay €4 and own the box.

Fly settings that matter:

```toml
# fly.toml (sketch)
primary_region = "waw"            # or "fra"
[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "off"      # the scheduler must keep running
  auto_start_machines = true
  min_machines_running = 1
[[mounts]]
  source = "data"
  destination = "/data"
[env]
  TZ = "Europe/Warsaw"
  APP_TIMEZONE = "Europe/Warsaw"
```

Never scale to two machines. Two schedulers would double-sync and double-plan. The volume pins the app to one machine anyway.

### Scheduler: keep `setInterval`, add a safety net

Keep `src/server/sync/scheduler.ts` as it is: on an always-on host it is simpler and more precise than cron. Two small additions:

- **Persist "already tried today"** in the `setting` table instead of only `globalThis`, so a deploy at 06:31 doesn't re-run the plan. `hasPlanFor` already guards most of this.
- **Optional external heartbeat** (Fly's health check on a new `/api/health`, or a free uptime monitor), so a crashed process gets restarted and you hear about it.

If we ever move to serverless (option D), the same functions become three cron-triggered route handlers (`/api/cron/sync`, `/api/cron/plan`, `/api/cron/review`) protected by a `CRON_SECRET`. The scheduler's logic already lives in small functions, so that refactor stays small. Not needed now.

### Code changes for hosting (later)

- `package.json`: `start` binds `127.0.0.1`. In the container it must bind `0.0.0.0` (e.g. `next start -H 0.0.0.0`, or a separate `start:prod`). Keep `dev` on 127.0.0.1.
- `Dockerfile`: `node:22-slim` (glibc, so `@libsql/linux-x64-gnu` resolves), `pnpm install --frozen-lockfile`, `next build`, and copy the `drizzle/` folder, because `boot()` migrates from `process.cwd()/drizzle`. Consider `output: "standalone"`, but check that file tracing picks up libsql's native module. It's listed in `serverExternalPackages`, which can need `outputFileTracingIncludes`. The plain `next start` image avoids that risk at the cost of a bigger image.
- `/api/health` route (no auth, returns `ok` plus the last sync time), excluded in the `src/proxy.ts` matcher.
- OAuth state cookies (`src/app/api/connect/*/start/route.ts`): add `secure: true` when `BETTER_AUTH_URL` is https.
- **Reminders syncer**: remove it from `SYNCERS` (or guard it with `process.platform === "darwin"`) in the cloud. See §6.

---

## 2. Database

Today: `@libsql/client` + Drizzle (`dialect: "turso"`), `file:./data/app.db`. The schema is portable: text ids, ms timestamps, JSON as text.

| Option | Code change | Pros | Cons |
|---|---|---|---|
| **A. SQLite file on the Fly volume** (recommended) | **None** (`DATABASE_URL=file:/data/app.db`) | Fastest: syncs do hundreds of small writes inside transactions, and local disk makes those free. Same engine as dev. Copying the DB over is `fly sftp` of one file | Backups are on us. The DB is tied to one machine (fine, single instance) |
| B. Turso (remote libsql) | Tiny: add `DATABASE_AUTH_TOKEN` to `env.ts`, `db/client.ts` and `drizzle.config.ts` | Managed, point-in-time restore, free tier (≈ 5 GB / 100 DBs) is plenty. Needed for serverless. Drizzle dialect and migrations unchanged | Every query is a network round trip. Per-row upserts in the sync transactions get noticeably slower. One more account and token |
| C. Postgres (Neon/Supabase/Fly PG) | Large: switch `sqlite-core` → `pg-core`, regenerate all migrations, change Better Auth's adapter `provider`, write a data copy script | Standard "real" DB | No benefit for one user and a 400 KB database. Most work, most risk |

**Recommendation: A.** Keep Turso (B) in reserve: if we ever drop the persistent server, switching is a URL and a token, because the dialect already is `turso`. Don't do Postgres.

**Backups for A** (personal data, keep it simple):

1. Fly volume snapshots: daily, kept 5 days by default (raise the retention to 14 days).
2. A nightly job in the scheduler (e.g. 03:17) that runs `VACUUM INTO '/data/backup.db'` and uploads it to object storage (Tigris on Fly, or Cloudflare R2; both have free tiers at this size). The copy is safe to keep: credentials inside are encrypted with `APP_ENCRYPTION_KEY`, which never goes into the bucket.
3. Restore drill once: download a backup, run `pnpm dev` against it with the production keys in a throwaway env.

Litestream (continuous replication) is the upgrade if a day of lost manual logs ever matters. It needs WAL mode.

---

## 3. Secrets and encrypted tokens

What exists:

- **Env secrets**: `BETTER_AUTH_SECRET` (session cookies + encrypted sign-in OAuth tokens), `APP_ENCRYPTION_KEY` (AES-256-GCM for every row in `integration`: Google refresh token, iCloud app password, Notion secret, Strava tokens, Hevy key, Claude API key), `GOOGLE_CLIENT_*`, `STRAVA_CLIENT_*`, optional `ANTHROPIC_API_KEY`.
- **DB secrets**: the `integration.credentials` column (encrypted with the key above) and Better Auth's `account` tokens (encrypted with `BETTER_AUTH_SECRET`).

Plan:

- Store all env secrets with `fly secrets set` (encrypted at rest, injected as env vars, never in the image or the repo). `.env.local` stays Mac-only.
- **Hand the current keys to production along with the DB.** The copied `integration` rows are only readable with the same `APP_ENCRYPTION_KEY`, and the copied sessions and accounts with the same `BETTER_AUTH_SECRET`. That avoids reconnecting six services and keeps your manual history (weigh-ins, reels, reading logs, plans, AI log), which lives only in this DB.
- **After the switch, give the Mac new keys** (`pnpm secrets`) and a fresh dev DB. Then the laptop holds no production credentials, and a stolen laptop or a leaked `.env.local` can't decrypt production backups.
- **Never run both environments against the same connections.** Strava rotates refresh tokens, so two servers refreshing the same token will log one of them out. Google's refresh token is shared but fine. During the parallel run (§8), production syncs and the Mac doesn't.
- Optional later: a key-rotation script (decrypt with the old key, re-encrypt with the new key, using the `v1.` prefix already in the format). Not needed for the move.
- Logs: Fly keeps stdout. The code already logs only error messages, never credentials. Keep it that way.
- Add `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` only if we ever run more than one instance. One instance doesn't need it.

---

## 4. OAuth and URL changes

Pick the domain first. The examples use **`https://dash.example.com`**. A `*.fly.dev` name works for a trial, but your own subdomain survives a host change without touching Google and Strava again.

| Where | Change |
|---|---|
| `BETTER_AUTH_URL` (Fly secret/env) | `https://dash.example.com`. Every redirect URI in the code is built from it: Better Auth's base URL, `src/server/integrations/google/oauth.ts`, `stravaAuthUrl`, and the dashboard links the MCP tools return |
| Google Cloud → Branding → **Authorized domains** | Add `example.com` (or the `*.fly.dev` app domain) |
| Google OAuth client → **Authorized JavaScript origins** | Add `https://dash.example.com` (keep `http://localhost:3000`) |
| Google OAuth client → **Authorized redirect URIs** | Add `https://dash.example.com/api/auth/callback/google` (Better Auth sign-in) and `https://dash.example.com/api/connect/google/callback` (Calendar/Gmail). Keep the localhost pair for dev |
| Google audience | Stays **In production, unverified**. Nothing changes for the restricted `gmail.readonly` scope: still personal use, still under the 100-user cap |
| Strava → My API Application | Authorization Callback Domain: `dash.example.com`. Website: the same URL. Strava allows only one callback domain, but `localhost`/`127.0.0.1` are always accepted, so dev keeps working. Re-check this on Strava's API page when switching |
| Better Auth | With an https base URL, cookies become `Secure` automatically. Its built-in rate limiting is on in production; keep it |
| MCP connector (new) | Claude's OAuth callback (`https://claude.ai/api/mcp/auth_callback`) is registered by Claude itself through dynamic client registration, so there's nothing to add in Google for it |

Optional cleaner split: a **second Google OAuth client** just for production, so dev can never mint production tokens. That's more setup, and one client with both URI sets is fine for a single user.

Now possible but not needed: **Strava webhooks** (a public URL exists now). Polling every 15 minutes is enough. Leave it for later.

---

## 5. Claude access without the Mac: a remote MCP endpoint

### 5.1 Transport

The installed SDK (`@modelcontextprotocol/sdk` 1.32) ships `WebStandardStreamableHTTPServerTransport`, which takes a Web `Request` and returns a `Response`. That maps directly onto a Next.js route handler, so **no separate server and no Express**:

- New `src/app/api/mcp/route.ts` (`GET`/`POST`/`DELETE`) running in the same Node process as the app. It shares `db()`, `env()` and the scheduler's fresh data.
- **Stateless mode** (`sessionIdGenerator: undefined`, `enableJsonResponse: true`): a new `McpServer` + transport per request. Our tools are short request/response calls, so we don't need sessions or server-initiated SSE, and stateless mode also works on serverless if that ever happens.
- Refactor `src/mcp/server.mts`: move the tool and prompt registrations into `src/mcp/register.ts` (`registerDashboardTools(server)`), used by both the stdio entry point (kept for local dev) and the HTTP route. The minimised-data and proposals-only rules stay in one place.
- `freshen()` can stay. On the server the scheduler keeps feeds fresh, so it'll mostly be a no-op.
- Log the client as `claude-connector` (vs `claude-desktop`) in `aiRun.model`, so the AI log shows where a run came from.

### 5.2 Auth

Claude's custom connectors authenticate with **OAuth 2.1** (authorization code + PKCE, with dynamic client registration or a client-ID metadata document). There's no "paste a bearer token" option in the claude.ai UI. An unauthenticated secret URL is technically possible, but too weak for a server that reads your mail subjects and calendar.

| Option | Verdict |
|---|---|
| **Better Auth as the OAuth authorization server** (its MCP / OAuth-provider plugin: `@better-auth/mcp` or `@better-auth/oauth-provider`, depending on the exact 1.7.x line; check the changelog when implementing) | **Recommended.** Same app, same DB, and sign-in is the existing Google login, so the `ALLOWED_EMAIL` allow-list and the session hook still decide who gets in. It serves `/.well-known/oauth-authorization-server`, the protected-resource metadata, `/register`, `/authorize`, `/token`, and gives us a helper to check the bearer token in `/api/mcp` |
| MCP SDK's own auth router (`server/auth/*`) | It's Express-based. We'd have to adapt it to route handlers and still write the user login. More glue, no gain |
| External IdP (Auth0, WorkOS, Stytch) | Works, but it's another account and another allow-list to maintain for one user |

Rules for the endpoint:

- Every MCP request must carry a valid access token **whose user is `ALLOWED_EMAIL`**. Check that in the route handler, not only at login.
- Short-lived access tokens (≈1 h) with refresh tokens. Revoking from Settings (a "Connected apps" list) kills Claude's access.
- One scope, e.g. `dashboard`. The tools stay as they are today: read minimised data, write proposals only. Nothing gains write access to Google or Notion.
- `src/proxy.ts`: the matcher currently returns 401 for any `/api/*` without a session cookie. Exclude `/api/mcp` (bearer-token auth instead of cookies), `/.well-known/*` and the OAuth endpoints, and do the real check in the handlers.
- Rate-limit `/api/mcp` and `/register` (Better Auth's limiter, or a simple per-IP counter). Cap dynamic client registrations, since each new Claude connection can register a new client.

### 5.3 Connecting Claude

- **claude.ai → Settings → Connectors → Add custom connector** → `https://dash.example.com/api/mcp`, leave client ID/secret empty (Claude registers itself). Sign in with Google when asked. Custom connectors work on Pro/Max plans in Claude web and Desktop. Mobile support for custom connectors isn't confirmed in Anthropic's official docs, so test it on the phone.
- Remove the local `personal-dashboard` entry from `claude_desktop_config.json` after the switch, otherwise Desktop shows two copies of every tool (or keep it pointed at a dev DB under a different name).
- The prompts ("Plan my day" etc.) come along: `registerPrompt` works over HTTP too.

### 5.4 The 07:59 schedule

Moving the tools to the cloud isn't enough, because **Desktop scheduled tasks don't run while the Mac sleeps**. Two ways to make the morning plan independent of the laptop:

| | Cloud routine using the connector (recommended for you) | Server-side Claude API plan (existing code) |
|---|---|---|
| How | A Claude Code **routine** on Anthropic's cloud (claude.ai/code → Routines, or `/schedule`), daily ~07:30 Europe/Warsaw, prompt = "Plan my day", with the `personal-dashboard` connector attached | Add an API key in Settings. The scheduler already plans at 06:30 after a fresh sync |
| Billing | Your Claude subscription (no API key, same as today) | API usage, ≈ $3–5/month (§8) |
| Moving parts | Routine + connector + OAuth token refresh | None new. It's built and tested |
| Failure mode | If the connector's token expires, the run fails until you re-auth | If the key is missing or out of credit, the plan falls back to first open of Today |

Recommendation: **use a cloud routine**, because it keeps the "no API key" choice. Keep the server's existing fallback (the plan is generated on the first open of Today if none exists) as the safety net. That fallback needs the API key, so either add one for the fallback only or accept "ask Claude" as the fallback. Check when setting it up that routines can use claude.ai custom connectors and how they're attached; the routine product is new and its UI changes often.

---

## 6. What can't move: Apple Reminders

`src/server/integrations/reminders.ts` runs JXA through `osascript` against the Reminders app, and iCloud no longer exposes Reminders over CalDAV. A Linux container can't do that.

| Option | Freshness with the Mac closed | Work |
|---|---|---|
| a. Drop Reminders | n/a | Delete the feed. You lose "reminders due today" in Today and the plan |
| **b. Push from the iPhone (Shortcuts)** (recommended, primary) | Good: the phone is always on | Personal automation "Time of day" (e.g. 06:45, 12:00, 18:00, *Run Immediately*): **Find Reminders** (not completed, due within 14 days or flagged) → build JSON → **Get Contents of URL** POST to `/api/ingest/reminders` with a device token header. No app to install |
| **c. Push from the Mac (`launchd` agent)** (optional, secondary) | Only while the Mac is awake | A small script reusing the existing JXA `SCRIPT`, run every 15 minutes by `launchd`, POSTing the same JSON. Gives near-live updates while you're at the desk |
| d. Keep a Mac "agent" that the cloud calls | Worse: the cloud would have to reach a sleeping Mac | Needs a tunnel. No benefit over (c) |

**Recommendation: b + optional c**, both feeding one endpoint:

- `POST /api/ingest/reminders`, body = the same `RawReminder[]` shape as today, `Authorization: Bearer <REMINDERS_PUSH_TOKEN>`. The token is a random secret stored hashed, created and revoked under Settings → Apple Reminders ("Generate push token"). The handler runs today's filter + replace-all logic (`syncReminders` with the read step swapped for the request body), records a `syncRun` with a new trigger `push`, and updates `feed.lastSyncedAt`, so the Today page shows how fresh it is.
- Payload is minimal: id, list, title, due, flagged, priority. No notes.
- The cloud never runs `osascript`. The reminders feed has no syncer there.
- If the iPhone automation turns out unreliable (iOS sometimes delays automations when the phone is locked), the Mac agent covers working hours and the plan still works without reminders.

---

## 7. PWA and phone access

Once it's on HTTPS this is cheap. Next 16 has the pieces built in (`node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`):

1. `src/app/manifest.ts`: name "Dashboard", `display: "standalone"`, `start_url: "/today"`, theme and background colours from the shadcn tokens, 192/512 px icons plus an Apple touch icon in `public/`.
2. `appleWebApp` metadata in `src/app/layout.tsx` (title, status bar style).
3. **Mobile pass** on Today (timeline, block Approve/Edit/Skip buttons, quick logs) and the nav, the screens you'd use on the phone. Week/Month just need to not overflow.
4. **No service worker / offline mode** in the first step. The data is live and behind login, so caching it on the phone adds risk and buys little.
5. Later: **web push** ("Your plan is ready: 3 blocks to approve", "Weigh-in today"). Needs a service worker, VAPID keys (`web-push`), a `push_subscription` table, and iOS 16.4+ with the app added to the Home Screen.

Things to check on the iPhone:

- A Home Screen app has its **own cookie jar**: sign in once inside the installed app. Sessions last 30 days, renewed daily.
- Google sign-in inside a standalone PWA: Google blocks embedded webviews, but iOS standalone apps are Safari, so it should work. Test it, because it's the one flow that can break.

---

## 8. Cost and migration order

### Monthly cost (approximate, check the providers' pages before signing up)

| Item | Cost |
|---|---|
| Fly.io: shared-cpu-1x, 1 GB RAM, always on | ≈ $5–7 (512 MB ≈ $3.70 may be enough. The image is built before deploy, so runtime is only `next start` plus syncs; start at 1 GB, then measure) |
| Fly volume 1 GB + snapshots | ≈ $0.15–0.30 |
| Backup bucket (Tigris / R2) | $0 at this size |
| Domain | $0 if you own one, otherwise ≈ $1/month |
| Turso (only if chosen) | $0 (free tier) |
| Claude via subscription (connector + routine) | $0 extra |
| *Optional* Claude API path: morning plan on `claude-opus-5-5` ($4 / $20 per MTok), ≈ 6k in + ≈ 4k out incl. thinking ≈ $0.10/day | ≈ $3/month |
| *Optional* mail triage on `claude-haiku-5-5` ($0.10 / $0.50 per MTok) | < $0.20/month |
| *Optional* weekly review on Opus | ≈ $0.60/month |
| **Total** | **≈ $5–8/month** (subscription path), **≈ $9–12/month** with the API path |

### Migration order (the Mac setup keeps working until step 9)

Each step is shippable on its own. Nothing breaks the local setup before the cutover.

1. **Domain + accounts.** Pick `dash.<your-domain>`. Create the Fly app (`waw`), a 1 GB volume and a bucket. No code yet.
2. **Make the code host-agnostic** (works the same on the Mac): `start:prod` binding `0.0.0.0`, `Dockerfile`, `/api/health`, `secure` OAuth state cookies, reminders syncer only on macOS, nightly `VACUUM INTO` backup behind an env flag. Run `pnpm build && pnpm start:prod` locally to check.
3. **Reminders push endpoint** + Settings "Generate push token" + the iPhone Shortcut. Test it against the *local* app first: the Mac can keep `osascript` while the push path is proven.
4. **Remote MCP endpoint** (`/api/mcp`, stateless) with the shared `register.ts`, still served locally. Test it with the MCP Inspector against localhost using a temporary dev bearer token.
5. **OAuth for MCP** (Better Auth plugin, `.well-known` metadata, proxy matcher exclusions, token check in the route, Connected-apps revoke list). Test it end to end locally with the Inspector's OAuth flow.
6. **First deploy to Fly with an empty database** and *new* throwaway keys. Add the production redirect URIs to Google. Sign in at `https://dash.example.com`, connect Google only, check sync, the plan page and logs. Then disconnect and wipe that volume. This is a smoke test that touches none of your real data.
7. **PWA basics** (manifest, icons, mobile pass). Deploy and add to the iPhone Home Screen.
8. **Dry-run the cutover:** copy a snapshot of `data/app.db` with the *real* keys into a scratch Fly app, check that integrations decrypt and sync, then destroy it. Don't connect Strava there (refresh-token rotation).
9. **Cutover (≈ 30 minutes):**
   1. Stop `pnpm dev` on the Mac. Quit Claude Desktop, or disable its local MCP entry.
   2. `fly secrets set` the real `BETTER_AUTH_SECRET`, `APP_ENCRYPTION_KEY`, Google/Strava client secrets, `ALLOWED_EMAIL`, `BETTER_AUTH_URL=https://dash.example.com`.
   3. Upload `data/app.db` to `/data/app.db` (`fly ssh sftp`), restart the machine (migrations run on boot).
   4. Change the Strava callback domain. Sign in. **Sync now**, and check every feed in Settings.
   5. Add the custom connector in claude.ai, sign in, ask "Plan my day" from web and from the phone.
   6. Create the cloud routine (≈ 07:30), and **delete the 07:59 Desktop scheduled task**.
   7. Switch the iPhone Shortcut and the optional Mac agent to the production URL and token.
10. **Retire the local production state:** move `data/app.db` to an encrypted archive, run `pnpm secrets` for new dev keys, start a fresh dev DB (connect only what you're developing against; skip Strava or use a second Strava app), and update `SETUP.md` (a new "Hosted" section, with the local setup kept as "Development").
11. **Week 1 checks:** the routine ran every morning with the lid closed, the backup object appears nightly, health checks are green, and Reminders freshness in Today is acceptable. Then decide on Litestream, web push and Strava webhooks.

Rollback at any point up to step 10: stop the Fly machine, start `pnpm dev` on the Mac with the old `.env.local` and the untouched `data/app.db`, re-enable the Desktop MCP entry. Plans and logs made in the cloud during the gap stay in the cloud DB; copy it back with `fly ssh sftp` if needed.

---

## Open questions for you

1. **Domain:** do you have one to put `dash.` on, or start on `*.fly.dev`?
2. **Fly.io vs a €4 VPS:** fine with Fly's ≈ $5–7, or prefer owning a box?
3. **Morning plan:** cloud routine on your subscription (recommended), or add a Claude API key so the server plans at 06:30 by itself? Either way, should the API key be added only as a fallback?
4. **Reminders:** is the iPhone Shortcut acceptable, or would you rather drop Reminders from the cloud version?
5. **Old local data:** carry it over (recommended: keeps weigh-ins, reels, AI log) or start the cloud fresh and reconnect everything?
