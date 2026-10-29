# Personal Dashboard — Vision

> Status: **pre-code**. This defines *why* and *what*. Decisions dated 2026-10-29.

## Why

My week is spread across two calendars, two inboxes, a notes app and Strava. None of them tell me whether I'm actually moving toward my goals. I want one calm, minimal screen that answers three questions:

1. **Today:** what matters, and when do I do it?
2. **This week:** am I on track (2 trainings, 3 runs, reading, goal steps)?
3. **This month:** are my main goals actually moving?

AI should do the boring part (reading everything, finding free time, drafting the plan) and I decide.

## Principles

- **Minimal.** One glance, no clutter. Few numbers, big type, lots of whitespace.
- **Single user.** Only me. Private by default, behind login.
- **AI suggests, I approve.** The AI never writes to my calendar or Notion without a tap from me.
- **Data stays where it lives.** Calendars stay in Google/iCloud, goals and notes in Notion, runs in Strava. The dashboard reads, combines and (on approval) writes back.
- **Progress is measured, not self-reported, where possible.** A run counts when Strava has it.

## Sources

| Source | What we use | How we connect | Notes |
|---|---|---|---|
| Google Calendar | Events, free/busy, create approved blocks | Google OAuth, Calendar API | Read + write |
| iCloud Calendar | Events, free/busy | CalDAV (`caldav.icloud.com`) with an app-specific password | Read; write optional |
| Gmail | Unread/important threads → AI summary; sorted into folders (labels), stars on approval | Google OAuth, Gmail API (`gmail.modify`) | Restricted scope: fine for personal use, but check token expiry rules for apps in "Testing" mode. Writes are labels and approved stars only (see docs/MAIL_AND_PAYMENTS.md) |
| iCloud Mail | Unread/recent → AI summary | IMAP (`imap.mail.me.com:993`) with an app-specific password | Read-only |
| Notion | Goals, steps, reading list, notes, reviews | Notion internal integration, databases | Source of truth for goals; two-way sync |
| Strava | Runs | Strava OAuth, polled on sync | Auto-checks planned runs |
| Hevy | Gym workouts: exercises, sets, reps, weight; exercise history; body measurements | Hevy public API with an API key (needs Hevy Pro) | Read-only. Source of truth for gym sessions. API is early and may change |
| Claude API | Daily plan, mail summary, weekly review | Server-side only | Model choice in kickoff prompt |
| Manual logs | Weekly weight, reels posted, current page of the book | Entered in the dashboard | One tap each; no Instagram, calorie-app or Apple Books sync in v1 |

## Core model

- **Categories**: Fitness & health, Work, Personal, Relationship.
- **Main goals** (1–3, the current focus) and **secondary goals** (the rest). Each has a category, a why, a target date and a measure.
- **Measure**: every goal has one of four kinds, which decides how progress is shown:
  - **Number**: start → target value (e.g. weight 74 → 80 kg). Progress = how far from start to target.
  - **Steps**: a checklist of steps. Progress = steps done / total.
  - **Habit**: a weekly frequency (e.g. 2–3 reels / week). Progress = weeks on target.
  - **Done / not done**: one milestone (e.g. visit a new country).
- **Steps**: small, actionable tasks under a goal, each with an estimate (e.g. 30 / 60 / 90 min).
- **Weekly targets (habits)**:
  - Training (gym, full body): **2× / week**, Tuesday and Saturday. Counted from Hevy workouts (or confirm manually)
  - Running: **3× / week**: Wednesday easy run (run club), Friday intervals/speed, Sunday long or easy. Counted from Strava runs
  - Reels: **2–3× / week** (logged manually in the dashboard)
  - Reading: **1 book / month** (see Reading below)
- **Strength** (from Hevy): volume per workout and the trend of a few key lifts (configurable), shown on Week and Month. Supports the weight goal: gaining weight while lifts go up.
- **Weight**: one weigh-in a week. The Today screen asks for it on Monday morning until I enter it. If I already logged weight in Hevy that week, use that instead of asking. Calories (target **3000 kcal/day**) are tracked in Fitatu, not in the dashboard; Fitatu has no public API, so there is no sync.
- **Reading**: one "currently reading" book at a time, with its total pages (stored in Notion). After reading I log the page I'm on; the dashboard works out pages read, an estimated finish date, and the pages per day needed to finish by the end of the month. A book counts as finished when I reach the last page.

## My goals (seed for v1)

Current focus (main goals): **Reels** and **Work**. Everything else is secondary.

| Category | Goal | Measure | Target date | Notes |
|---|---|---|---|---|
| Personal | Post 2–3 reels a week about running and fitness, in Polish | Habit | Ongoing | **Main** |
| Work | Rebuild my CV | Steps | 2026-11-30 | **Main**; steps in `GOALS.md` |
| Work | Finish AI certifications | Steps | 2026-11-30 | **Main**; steps in `GOALS.md` |
| Work | Finish the design system course | Steps | 2026-12-31 | |
| Work | Build a system that autoposts interesting things to LinkedIn without an obvious AI feel | Steps | 2026-12-31 | A project I build; the dashboard only tracks its steps |
| Fitness & health | Reach 80 kg (now 74 kg) | Number | 2027-02-28 | Weekly weigh-in; supported by not skipping gym and runs and eating ~3000 kcal/day |
| Fitness & health | Repair 2 teeth | Steps | 2026-12-31 | Book visit → treatment 1 → treatment 2 |
| Personal | Read one book a month | Habit (monthly) | Ongoing | See Reading |
| Personal | Visit a country I've never been to | Done / not done | — | No date yet |
| Relationship | — | — | — | No goal yet |
- **Day plan**: today's events + suggested time blocks for steps and habits, approved by me.
- **Reviews**: a short evening check-in and a weekly review (Sunday), generated by AI and saved to Notion.

## Screens

1. **Today**: AI morning brief (3–5 lines), timeline of today's events from both calendars, suggested blocks to approve, top 3 steps, mail summary (Gmail + iCloud, grouped: needs reply / worth a look / FYI / ignore), payments that need me (only when something is due or failed), quick reading log.
2. **Week**: habit rings (2 trainings, 3 runs, reading), goal steps done vs planned, the week's calendar at a glance, what's at risk ("no run planned before Friday").
3. **Month**: progress per main/secondary goal, habit consistency heatmap, run totals from Strava, books finished.
4. **Goals**: main and secondary goals with their steps; add/edit (writes to Notion); AI can break a goal into steps on request.
5. **Review**: evening check-in and weekly review history.

## AI behaviour

- **Morning plan** (scheduled, e.g. 06:30, plus on demand): reads today's calendars, open steps, weekly progress and mail summary; proposes time blocks in free slots and the top 3 steps. Each block has Approve / Edit / Skip. Approved blocks go to Google Calendar.
- **Mail summary**: groups threads, highlights what needs a reply. Never sends mail.
- **Week guard**: if the week's targets are at risk, suggests where to fit the missing run/training/reading.
- **Weekly review**: what got done, what slipped, suggested focus for next week, saved to Notion after I confirm.
- Sends only the minimum data to the model (subjects/snippets, not whole inboxes); no training on my data.

## Out of scope (v1)

- Sending or replying to email
- Multi-user, sharing, teams
- Native mobile app (a PWA is enough)
- Apple Health, Goodreads/Kindle sync
- Instagram API and calorie-app sync (manual logs instead)
- Apple Books sync: no public API; only possible by reading the Books app's private local database on the Mac. Maybe later, for e-books only.
- The LinkedIn autoposting system itself (separate project; the dashboard only tracks the goal)
- Hosting in the cloud, phone access, PWA (later)

## Decisions (2026-10-29)

- **Hosting: local on my Mac.** SQLite instead of hosted Postgres. Strava is polled on each sync instead of using webhooks (no public URL). The morning plan is generated on the first app open of the day if the scheduled run didn't happen (Mac asleep).
- **Design: as simple as possible.** Plain layout, default shadcn/ui styling, no animations in v1. Upgrade later if needed.
- **Approved blocks go to Google Calendar.** Use a dedicated "Plan" calendar inside my Google account so AI blocks are easy to see and hide.
- **Target dates** are in "My goals". Reading is 1 book a month; calories 3000 kcal/day (in Fitatu).

- **Planning rules:**
  - Blocks only between **08:00 and 21:00**.
  - Work: 6 tracked hours, usually 10:00–16:00, Monday–Friday. Nothing else gets planned inside work hours. Saturday and Sunday are work-free.
  - Weekly rhythm:

    | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
    |---|---|---|---|---|---|---|
    | Rest | Gym | Easy run (run club) | Rest | Intervals | Gym | Long/easy run |

  - Monday and Thursday are workout rest days. Thursday is the catch-up slot: the week guard may suggest a gym session there only if Tuesday's was missed.
- **AI briefs in English.**

## Still open (decide in kickoff)

- Confirm the Claude Academy course set in `GOALS.md`
