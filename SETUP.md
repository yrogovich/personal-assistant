# Setup

Everything runs locally on your Mac at <http://localhost:3000>. Secrets live in `.env.local` or `.env` (both gitignored, never committed) and in the local SQLite database, where every token and password is encrypted with `APP_ENCRYPTION_KEY`.

Covers: **Google**, **iCloud**, **Notion**, **Strava**, **Hevy**, **Apple Reminders**, and the AI: **Claude Desktop** (your subscription, no API key) or the **Claude API**.

## 1. Install and create `.env.local`

This project uses **pnpm** (pinned in `package.json` → `packageManager`).

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

```bash
pnpm secrets
```

Paste the two printed lines (`BETTER_AUTH_SECRET`, `APP_ENCRYPTION_KEY`) into `.env.local`, and set `ALLOWED_EMAIL` to your Gmail address.

Keep `APP_ENCRYPTION_KEY` safe: if you lose it, stored connections can't be decrypted and you have to reconnect everything.

## 2. Google Cloud (sign-in, Calendar, Gmail)

1. Open <https://console.cloud.google.com>, create a project (e.g. "Personal Dashboard").
2. **APIs & Services → Library**: enable **Google Calendar API** and **Gmail API**.
3. **Google Auth Platform → Branding**: app name "Personal Dashboard", your email as support and developer contact.
4. **Audience**: User type **External**. Under *Test users*, add your Gmail address.
5. **Data access → Add or remove scopes**, add:
   - `.../auth/calendar.readonly`: read all your calendars
   - `.../auth/calendar.app.created`: create the "Plan" calendar and manage events **only in calendars this app created**
   - `.../auth/gmail.readonly`: read mail (used from build step 5; requested now so you only consent once)
6. **Clients → Create client → Web application**:
   - Authorized JavaScript origin: `http://localhost:3000`
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google` (sign-in, handled by Better Auth)
     - `http://localhost:3000/api/connect/google/callback` (Calendar/Gmail access)
   - Copy the client ID and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
7. **Audience → Publish app → In production.** Don't submit for verification. See below for why.

### "Testing" vs "Production" and the restricted Gmail scope

| | Testing | Production, unverified (chosen) |
|---|---|---|
| Who can sign in | Only listed test users | Anyone, capped at 100 users ever. Our allow-list still admits only you |
| Refresh token lifetime | **Expires after 7 days** for apps asking more than name/email: you'd reconnect Google every week | Long-lived. Revoked only if you revoke it, change your Google password (Gmail scopes), or leave it unused for 6 months |
| Consent screen | Normal | Shows **"Google hasn't verified this app"**. Click *Advanced → Go to Personal Dashboard (unsafe)*. It's your own app |
| Verification | Not needed | Not needed for personal use. `gmail.readonly` is a *restricted* scope: verifying it for the public would require a paid third-party security assessment (CASA), which makes no sense for a single-user app |

If Google ever stops refreshing (password change, revoked access), the dashboard shows "reconnect needed" and Settings has a **Reconnect** button.

## 3. iCloud (Calendar and Mail)

One app-specific password covers both CalDAV (calendar) and IMAP (`imap.mail.me.com`, mail). Mail is read-only: INBOX is opened read-only, so nothing gets marked as read.

1. Two-factor authentication must be on for your Apple ID.
2. Go to <https://account.apple.com> → **Sign-In and Security → App-Specific Passwords** → **+**, name it "Dashboard".
3. Copy the `abcd-efgh-ijkl-mnop` password.
4. In the dashboard: **Settings → iCloud**, enter your Apple ID email and that password.

To cut access, revoke the password at account.apple.com, or press **Disconnect** in Settings.

## 4. Notion (goals, steps, books, reviews)

1. Go to <https://www.notion.so/profile/integrations> → **New integration**.
   - Type: **Internal**. Name: "Dashboard". Workspace: yours.
   - Capabilities: **Read content**, **Update content**, **Insert content**. No user information needed.
   - Copy the **Internal Integration Secret** (`ntn_…`).
2. In Notion, create an empty page called **Dashboard**.
3. On that page: **••• → Connections → Dashboard** (the integration), so it can see the page.
4. In the dashboard: **Settings → Notion**, paste the secret and the page link (••• → Copy link).

On connect the app creates four databases inside the page and seeds your goals and steps once. This takes about 30 seconds because of Notion's rate limit:

| Database | Properties |
|---|---|
| **Goals** | Name, Category (Fitness & health / Work / Personal / Relationship), Priority (Main / Secondary), Why, Target date, Measure (Number / Steps / Habit / Done / not done), Habit period, Habit min, Habit max, Start, Target, Unit, Status, Steps ↔ |
| **Steps** | Title, Goal ↔, Estimate (min), Status (To do / Planned / Done / Skipped), Due, Order, Done on |
| **Books** | Title, Total pages, Current page, Status (Reading / Finished), Started, Finished |
| **Reviews** | Title, Type (Daily / Weekly), Period, Status (Draft / Confirmed); the review text is the page body |

Keep those property names: the sync reads them by name. Reconnecting never duplicates anything: databases already in the page are found and reused, and the seed only runs when Goals is empty.

## 5. Strava (runs)

1. Go to <https://www.strava.com/settings/api> and create an app:
   - Category: anything (e.g. "Data Importer"). Website: `http://localhost:3000`.
   - **Authorization Callback Domain: `localhost`**
2. Copy **Client ID** and **Client Secret** into `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` in `.env.local`, and restart `pnpm dev`.
3. **Settings → Connect Strava** and keep **"View data about your private activities"** ticked (scope `activity:read_all`), so "Only me" runs count too.

Strava is polled on each sync (no webhooks while the app runs locally): 90 days back on first sync, then the last 14 days every time, so edits and deletions show up.

## 6. Hevy (gym workouts, weigh-ins)

1. Needs **Hevy Pro**. On <https://hevy.com> go to **Settings → Developer** and create an API key.
2. **Settings → Hevy** in the dashboard, paste the key.

First sync reads the last 12 months of workouts. After that only changes since the last sync (`/v1/workouts/events`). Weigh-ins logged in Hevy (body measurements) count as your weekly weigh-in.

## 7. Apple Reminders

iCloud stopped serving Reminders over CalDAV with the iOS 13 "upgraded" Reminders, so the dashboard reads them from the **Reminders app on this Mac** (read-only, via `osascript`).

1. **Settings → Apple Reminders → Connect Reminders.**
2. macOS asks whether the app that runs `pnpm dev` (Terminal, iTerm, or your editor) may control **Reminders**. Click **Allow**.
   If you clicked Don't Allow: **System Settings → Privacy & Security → Automation**, enable Reminders for that app, then retry.

Open reminders due within two weeks (or flagged) are cached. Today shows the ones due today, overdue, or flagged. The morning plan sees the titles of those due today or overdue.

## 8. AI: Claude Desktop or the Claude API

You need one of the two. Both follow the same rules: minimal data in, only *proposals* out, everything approved by you in the dashboard, everything logged in **Settings → AI log**.

| | Claude Desktop (MCP) | Claude API |
|---|---|---|
| Billing | Your Claude subscription | API usage (pay per token) |
| Morning plan | When you ask ("Plan my day") | Automatically at 06:30, on first open, or **Replan** |
| Mail triage | When you ask ("Triage my mail") | On every mail sync |
| Weekly review | When you ask | Drafted Sunday from 18:00 |
| Break a goal into steps | Ask in Desktop | Button on the Goals screen |

### 8a. Claude Desktop (no API key)

The dashboard ships a local MCP server (`src/mcp/server.mts`, stdio). It reads the same SQLite data as the web app, so the dashboard must have synced at least once. It never sees tokens or passwords.

1. Print the config for this Mac:

```bash
pnpm mcp:config
```

2. Claude Desktop → **Settings → Developer → Edit Config**, merge the printed `personal-dashboard` entry into `mcpServers`, save, and restart Claude Desktop.
3. In a chat, open the **+** menu → personal-dashboard prompts: **Plan my day**, **Triage my mail**, **Draft my evening check-in**, **Draft my weekly review**, **Break a goal into steps**. Or just ask in your own words.
4. Approve in the dashboard: day blocks on **Today**, steps on **Goals**, reviews on **Review**.

Tools: `get_day_context`, `propose_day_plan`, `get_unsorted_mail`, `categorize_mail`, `get_progress`, `get_goal`, `propose_goal_steps`, `get_review_context`, `save_review_draft`. The read tools return the same minimised data as the API path; the write tools only store proposals (day blocks are checked against your free time exactly like API plans).

### 8b. Claude API (morning plan, mail triage)

1. Create a key at <https://platform.claude.com> → **API keys**.
2. **Settings → Claude API**, paste it. It's stored encrypted. Alternatively set `ANTHROPIC_API_KEY` in `.env.local`.

Models are config values:

| Variable | Default | Used for |
|---|---|---|
| `AI_PLAN_MODEL` | `claude-opus-5-5` | Morning plan (and, later, weekly review and "break into steps") |
| `AI_FAST_MODEL` | `claude-haiku-5-5` | Mail triage (needs reply / FYI / ignore) |

The planner uses Anthropic's server-side refusal fallback (`fallbacks: "default"`): if the model declines, the same request is retried on a fallback model instead of failing.

### What the AI sees (and doesn't)

- **Morning plan:** today's free slots and busy times (busy events have **no titles**, except your own run/gym/plan events), work hours and today's rhythm, this week's habit progress and risks, your current book and page, the next open steps (title, goal, estimate), titles of reminders due today, and for mail that needs a reply only the **sender name and subject**.
- **Mail triage:** sender name and domain (not the full address), subject, and Gmail's snippet (or the first ~300 characters of the plain-text body for iCloud). Bodies are never stored or sent. Only unread mail from the last 3 days.
- Never sent: tokens, passwords, full mailboxes, calendar event titles of other people's meetings.
- **Settings → AI log** shows every request exactly as it was sent, the model's output, token counts, and what you decided.

### When does the plan run? (Claude API; with Desktop it runs when you ask)

- At **06:30** while the server is running, after a fresh sync.
- If the Mac was asleep: as soon as the server runs again that day, or on the **first open of Today**.
- **Replan** any time. Approved blocks stay; unapproved ones from the earlier plan are replaced.
- **Free time at work today** (weekdays) lets the planner use that window for learning steps only (courses, certifications); your meetings still count as busy.

### Approving blocks

Nothing reaches your calendar until you press **Approve** (or **Edit → Save and approve**). The first approval creates a calendar called **Plan** in your Google account (the app can only manage calendars it created: `calendar.app.created`). **Remove from calendar** deletes the event again. Your own edits (step done, book page) save straight to Notion.

## Screens

- **Today:** AI brief, timeline from both calendars, proposed blocks (Approve / Edit / Skip), top 3 steps, mail (needs reply / FYI / ignore), reminders, quick logs, Monday weigh-in prompt.
- **Week:** habit rings, at-risk warnings with free-slot suggestions, steps done vs due, the week at a glance, runs and workouts.
- **Month:** goal progress grouped by category (main first), habit heatmap, weight trend (weekly weigh-ins, 12 weeks), key-lift trend (estimated 1RM from Hevy, 12 weeks), Strava run totals vs last month, books finished.
- **Goals:** goals by category with their steps; add or edit goals and steps (saved straight to Notion); AI "break into steps" proposals you tick and add.
- **Review:** evening check-in and weekly review: AI draft, your edits, **Confirm and save to Notion** (Reviews database, text as the page body); history of confirmed reviews.

How goal progress is measured: *steps* = done ÷ (all minus skipped); *number* (kg) = latest weekly weigh-in between start and target; *weekly habit* (reels) = finished weeks this month on target; *monthly habit* (reading) = books finished this month; *done / not done* = the goal's status.

## How runs and gym sessions are counted

- **Run:** a Strava run (Run, Trail Run, Virtual Run).
- **Gym:** a Hevy workout. A Strava strength activity (e.g. Hevy posting to Strava) counts only on a day without a Hevy workout, so one session never counts twice. Hevy wins.
- **Calendar sessions** (events matching the run/gym keywords, or on a calendar marked *Training*) with no Strava/Hevy match show as **"planned, not confirmed"** on the Week screen with an **I did it** button.
- **Week guard:** flags missed sessions (no catch-up suggestions), suggests a free slot for upcoming rhythm days with nothing planned, and suggests Thursday for gym only when Tuesday was missed. Suggestions never write to your calendar.

## 9. Run

```bash
pnpm dev
```

Open <http://localhost:3000> (use `localhost`, not `127.0.0.1`, so the Google redirect URIs and cookies match). Sign in with Google, then in **Settings**:

- **Connect Google** → approve → your calendars sync immediately.
- **Connect iCloud** with the app-specific password.
- Switch individual calendars on/off, and tick **Training** on a calendar that only holds workouts.
- **Connect Notion**, **Connect Strava**, **Connect Hevy**, **Connect Reminders**, and add the **Claude API** key.

The server only listens on `127.0.0.1`, so it isn't reachable from other devices on your network.

## Sync

- Automatic every 15 minutes at :07, :22, :37, :52 while the server runs (never on the hour), plus once at startup.
- **Sync now** on the Today page runs it on demand.
- Calendars are cached from 35 days back to 14 days ahead.

## Environment variables

| Variable | Purpose |
|---|---|
| `BETTER_AUTH_URL` | `http://localhost:3000` |
| `BETTER_AUTH_SECRET` | Better Auth's secret: signs session cookies and encrypts the sign-in OAuth tokens (`pnpm secrets`) |
| `APP_ENCRYPTION_KEY` | AES-256-GCM key for Google, iCloud, Notion, Strava, Hevy and Claude API credentials, 32 bytes base64 (`pnpm secrets`) |
| `ALLOWED_EMAIL` | The only account allowed to sign in and connect Google |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client from step 2 |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | Strava API app from step 5 (optional; Strava stays off without them) |
| `ANTHROPIC_API_KEY` | Optional (not needed with Claude Desktop); or set the key in Settings (stored encrypted) |
| `AI_PLAN_MODEL`, `AI_FAST_MODEL` | Default `claude-opus-5-5` / `claude-haiku-5-5` |
| `DATABASE_URL` | Default `file:./data/app.db` |
| `APP_TIMEZONE` | Default `Europe/Warsaw` |
