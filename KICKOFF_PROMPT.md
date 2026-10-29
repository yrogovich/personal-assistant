# Kickoff Prompt (v1)

> Put `VISION.md` in the new repo, then paste everything below the line into a fresh session.

---

Read `VISION.md` first. It's the source of truth for the why, sources, screens and AI behaviour.

## Goal
Build my **personal, single-user dashboard** that tracks weekly and monthly progress toward my goals. It combines Google Calendar, iCloud Calendar, Gmail, iCloud Mail, Notion and Strava, and uses AI to plan each day. The AI **suggests and I approve**: AI-made changes are never written to my calendar or Notion without my tap (my own edits save directly). The design is **as simple as possible** for v1: plain layout, default shadcn/ui styling, no animations, light and dark themes. It runs **locally on my Mac**.

## Before writing code: ask me
Ask these in one go and wait for answers:
1. Confirm the Claude Academy course set in `GOALS.md`.
2. Anything in `VISION.md` → "Decisions" that looks contradictory or underspecified to you.

## Stack (check latest stable versions before installing)
- Next.js App Router, React, TypeScript (strict). Read the Next.js docs in `node_modules/next/dist/docs/` if the version differs from what you know.
- Tailwind CSS + shadcn/ui, lucide-react icons. No animation library in v1.
- SQLite + Drizzle for cached data, tokens, plans and logs (local only; keep it portable to Postgres later).
- Auth: single user only (e.g. Auth.js with Google sign-in, allow-list of my email).
- Integrations:
  - Google Calendar + Gmail: official `googleapis`, OAuth with offline access. Explain the Google Cloud setup and the "Testing" vs "Production" token-expiry implications for the restricted `gmail.readonly` scope.
  - iCloud Calendar: CalDAV (e.g. `tsdav`) with an app-specific password.
  - iCloud Mail: IMAP (e.g. `imapflow`) with an app-specific password. Read-only.
  - Notion: official `@notionhq/client`, internal integration.
  - Strava: OAuth; poll recent activities on each sync (no webhooks while running locally).
  - Hevy: public API (`api.hevyapp.com`, API key from Hevy Pro settings). Read-only: workouts with sets, exercise history, body measurements. Use `/v1/workouts/events` for incremental sync. Don't schedule requests exactly on the hour (Hevy asks for this).
  - AI: Claude API via the official Anthropic SDK, server-side only. Use the latest capable model for planning/reviews and a smaller fast model for mail summaries; make model ids config values. Use structured output (tool/JSON schema) for plans so the UI can render Approve / Edit / Skip per block.
- Store all tokens and app-specific passwords encrypted at rest. Never send them to the client.

## Data model (propose, then build)
- `Goal` (category: fitness & health | work | personal | relationship; main | secondary; why; target date; measure kind: number | steps | habit | done; for number: start, target, unit; status) and `Step` (goal, title, estimate minutes, status, due) — **Notion is the source of truth**; create the Notion databases for me (or tell me exactly which to create) and seed them from `VISION.md` → "My goals" and the steps in `GOALS.md`.
- `Habit` targets: training 2×/week, running 3×/week, reels 2–3×/week, reading 1 book/month.
- `Event` cache from both calendars; `Activity` from Strava; `Workout` + sets from Hevy; manual logs: `ReadingLog` (book, page reached, date), `WeightLog` (weekly), `ReelLog`.
- `Book` (title, total pages, status: reading | finished) — lives in Notion; finished when the logged page reaches the total.
- `DayPlan` with `ProposedBlock` (start, end, kind: step | run | training | reading | other, status: proposed | approved | skipped, linked calendar event id).
- `Review` (daily / weekly), saved to Notion after I confirm.

## Matching rules
- A planned run counts as **done** when a Strava run overlaps or lands the same day near the planned time. A planned gym session counts as done when a Hevy workout lands the same day. If Hevy also posts the workout to Strava, count it once (Hevy wins). Calendar-only sessions without a Strava match show as "planned, not confirmed" and I can confirm manually.
- Detect training/run events in my calendars by title keywords or a dedicated calendar; make this configurable.

## Screens (see `VISION.md`)
1. **Today**: AI brief, merged timeline from both calendars, proposed blocks with Approve / Edit / Skip, top 3 steps, mail summary (needs reply / FYI / ignore, Gmail + iCloud), quick logs (current book page, reel posted, gym visit if Strava missed it), and a weigh-in prompt on Monday mornings until I enter it.
2. **Week**: habit rings (2 trainings, 3 runs, 2–3 reels, reading), steps done vs planned, at-risk warnings with a "fit it in" suggestion.
3. **Month**: goal progress grouped by category (main goals first), weight trend, key-lift trend from Hevy, habit heatmap, Strava run totals, books finished.
4. **Goals**: goals by category with their steps; "break into steps" with AI.
5. **Review**: evening check-in, weekly review (Sunday).
Responsive layout. PWA and phone access come later, with cloud hosting.

## AI jobs
- **Morning plan** (scheduled, plus a "Replan" button): inputs are today's free/busy from both calendars, open steps, weekly progress, planning rules, mail summary. Output: 3–5 line brief, top 3 steps, proposed blocks in free slots. Approved blocks are created in a dedicated "Plan" calendar in my Google account (create it during setup if missing).
- **Mail summary**: only unread/recent threads, only subject + sender + snippet unless I open a thread. Never sends mail.
- **Week guard**: flags targets at risk and suggests slots.
- **Weekly review**: draft, I edit, then saved to Notion.
- Log every AI suggestion and my decision so I can see what it proposed.

## Non-negotiables
- Single user, private. Nothing readable without login.
- AI never writes anywhere without explicit approval.
- Minimal data sent to the model; no secrets or full mailboxes in prompts.
- Every integration can be disconnected, and the dashboard still works without it (empty state, not a crash).
- Sync runs on a schedule and on demand; show "last synced" per source.
- Keyboard accessible, visible focus, `prefers-reduced-motion` respected.

## How to work
1. Ask the questions above. Wait.
2. Propose the data model, Notion database layout, and folder structure. Wait for my OK.
3. Build auth + Google Calendar + iCloud Calendar and the **Today** timeline first, with real data. Stop and show me.
4. Add Notion goals/steps, Strava and Hevy, then the **Week** view with habit rings.
5. Add mail (Gmail + iCloud IMAP) and the AI morning plan with approve-to-calendar.
6. Add **Month**, **Goals**, **Review** and the weekly review job.
7. Write a `SETUP.md` with every console step (Google Cloud, Apple app-specific password, Notion integration, Strava app, Hevy API key, Anthropic key) and the env vars.
Don't commit unless I ask.
