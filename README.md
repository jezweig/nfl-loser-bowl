# NFL Loser Bowl 2026

A static site (deployable via GitHub Pages) for running the NFL Loser Bowl
pool, backed by a free Supabase project for shared, live data — players
submit their own picks, see their own history, and everyone sees the
public standings once picks lock.

## Pages

- `index.html` — rules, entry fee/Venmo info, and a countdown to the next
  pick deadline.
- `pick.html` — players enter their name + PIN and submit their pick for
  the current week from the real, live NFL schedule.
- `history.html` — a player's own full-season pick history and strike
  count (only visible to them, verified by their PIN).
- `standings.html` — the public grid of every player's picks/strikes/
  status. A player's current-week pick stays hidden from everyone else
  until its deadline passes, then it's revealed to all.
- `admin.html` — commissioner-only tools (passphrase-gated): record each
  week's game results, and manage buybacks/PIN resets.

## One-time setup

### 1. Create a free Supabase project

Go to [supabase.com](https://supabase.com), create a free account and a
new project (any name/region/database password — you won't need the
password directly).

### 2. Run the schema

1. In your Supabase project, open **SQL Editor -> New query**.
2. Open `supabase/schema.sql` from this repo, and **before pasting it in**,
   find the line near the bottom containing `CHANGE_ME_ADMIN_PASSPHRASE`
   and replace it with your own commissioner passphrase (this is what
   gates `admin.html`). Only change it in the editor / a local copy —
   never commit your real passphrase to git.
3. Paste the whole script into the SQL editor and run it. This creates
   all tables, security policies, and the full 2026 schedule.

### 3. Wire up the site

1. In Supabase, go to **Project Settings -> API**.
2. Copy the **Project URL** and the **anon public** key (not the
   `service_role` key — that one must never be used in client-side code).
3. Edit `config.js` in this repo and paste both values in. This key is
   designed to be public/committed — access is controlled by the
   Row Level Security rules in `supabase/schema.sql`, not by hiding it.

### 4. Deploy

Push this repo and enable GitHub Pages (repo **Settings -> Pages**, source
= this branch/`main`, root folder). Any other static host works the same
way.

## How privacy works here

Players identify with just a name + a self-chosen 4-8 digit PIN (no email
required). All writes (submitting a pick, recording results, buybacks) go
through Postgres functions that verify the PIN or commissioner passphrase
**server-side** — the browser never gets to bypass that check. A pick is
only visible to anyone other than its owner once the real kickoff time (or
the Sunday 1pm ET deadline, whichever is earlier) has passed, enforced by
a Postgres Row Level Security policy — not just hidden in the page. This
is genuine server-enforced privacy, not just a UI convention.

The one thing this does *not* protect against: someone else guessing a
player's name + PIN. Since PINs are short and there's no rate-limiting UI,
this is "good enough for a friendly pool," not bank-grade security —
that's an intentional, agreed-on tradeoff for keeping sign-up frictionless.

## Updating the schedule

`supabase/schema.sql` seeds the full 2026 regular-season schedule. Some
late-season kickoff times (notably Week 18) aren't finalized by the NFL
this far in advance — update them later by running, in the Supabase SQL
editor:

```sql
update games set kickoff = '2027-01-10T21:25Z'::timestamptz
where week = 18 and home = 'KC' and away = 'LV';
```

## Commissioner workflow each week

1. After games finish, open `admin.html`, enter your passphrase.
2. Pick the week, and for each game select who won (or "Tie"). Strikes,
   eliminations, and the standings page all update automatically — no
   need to touch anything per-player.
3. If someone eliminated buys back in (through Week 8, $20 via Venmo),
   mark them "Rebought" with the week they re-entered.
