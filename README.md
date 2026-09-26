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
  status/paid status. A player's current-week pick stays hidden from
  everyone else until its deadline passes, then it's revealed to all.
- `admin.html` — commissioner-only tools (passphrase-gated): record each
  week's game results, mark players paid, and manage buybacks/PIN
  resets.

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

### 4. Automatic result syncing (optional but recommended)

A scheduled GitHub Action (`.github/workflows/sync-results.yml`) checks
ESPN's public scoreboard every hour and automatically records final scores
for any game that's finished but not yet entered — so results and
standings update themselves without you opening `admin.html` each week.
It writes through the exact same `admin_set_result` function the admin
page uses, so it needs your commissioner passphrase, stored as a secret
(never committed to the repo):

1. Repo **Settings -> Secrets and variables -> Actions -> New repository
   secret**.
2. Name: `ADMIN_PASSPHRASE`. Value: the same passphrase you set in
   `admin_config` in step 2 above.
3. That's it — it starts running on its hourly schedule automatically. You
   can also trigger it on demand from the **Actions** tab (select "Sync
   NFL results" -> **Run workflow**), e.g. right after Monday Night
   Football ends if you don't want to wait for the next hourly run.

`admin.html` still works exactly as before — use it any time to fix a
result the automation got wrong, enter one early, or handle buybacks/PIN
resets (which the automation doesn't touch).

### 5. Automatic emails (optional)

Two more scheduled GitHub Actions use [Resend](https://resend.com) (a
transactional email API — just an API key, no Gmail/OAuth account linking)
to email players directly:

- **`.github/workflows/send-reminders.yml`** — Sundays ~11:30am ET, emails
  anyone with an address on file who hasn't picked yet and isn't already
  eliminated, with the deadline and a link to `pick.html`.
- **`.github/workflows/send-recap.yml`** — Sundays ~2-3pm ET (after the 1pm
  deadline), emails everyone with an address on file who picked what that
  week.

Players opt in by entering an email on the `pick.html` login screen
(optional, never shown to other players — it's excluded from the public
`players` grant in the schema). Nothing is sent to anyone who leaves it
blank.

To turn this on:

1. Sign up at [resend.com](https://resend.com) (free tier: 3,000
   emails/month, plenty for a pool this size).
2. Verify a sender — either a single email address, or a domain for a more
   official-looking "from" address (Resend's dashboard walks you through
   the DNS records; this is just proving you own the address/domain, not
   connecting a personal inbox).
3. Create an API key in the Resend dashboard.
4. Add three more repo secrets (same place as `ADMIN_PASSPHRASE` above):
   - `RESEND_API_KEY` — the key from step 3.
   - `FROM_EMAIL` — e.g. `NFL Loser Bowl <picks@yourdomain.com>`, matching
     the sender you verified in step 2.
5. If you're starting mid-season, run `supabase/add_email_notifications.sql`
   once in the Supabase SQL editor (schema.sql already includes this for
   new setups).

Both workflows are idempotent per week (guarded by an `email_log` table via
`admin_claim_email_send`), so re-running one manually from the **Actions**
tab is always safe — it just no-ops if that week's email already went out.

### 6. Deploy

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

With the automation set up (step 4 above), results record themselves
within an hour of each game ending — nothing to do most weeks. All that's
left manually:

1. When someone Venmos their entry fee, open `admin.html` and click
   "Mark Paid" next to their name — this shows as a public "Paid"/"Unpaid"
   tag on `standings.html` so players can see who still owes.
2. If someone eliminated buys back in (through Week 8, $20 via Venmo),
   open `admin.html` and mark them "Rebought" with the week they
   re-entered.
3. Spot-check `standings.html` occasionally; if a result looks wrong (a
   postponed/rare edge case ESPN reported oddly), fix it by hand in
   `admin.html` — the automation will just leave it alone once a result
   exists for that game.

Without the automation set up, do this manually instead: after games
finish, open `admin.html`, enter your passphrase, pick the week, and for
each game select who won (or "Tie"). Strikes, eliminations, and the
standings page all update automatically either way — no need to touch
anything per-player.
