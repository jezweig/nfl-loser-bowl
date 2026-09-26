#!/usr/bin/env node
// Emails a "you haven't picked yet" nudge to any player who has an email
// on file, isn't eliminated, and has no pick recorded for the current
// week. Runs once a week via .github/workflows/send-reminders.yml,
// comfortably before the Sunday 1pm ET deadline. Uses admin_claim_email_send
// so a manual re-run (workflow_dispatch) never double-sends for the same week.

import { rpc, sbFetch } from "./lib/supabase.mjs";
import { sendEmail } from "./lib/brevo.mjs";

const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL;
const SITE_URL = "https://jezweig.github.io/nfl-loser-bowl/";

export function isEliminated(strikes, rebought) {
  return rebought ? strikes >= 1 : strikes >= 2;
}

// picks: [{week, team}], only ever called with already-locked (fully
// revealed) picks from weeks before the one being checked.
export function computeStrikes(picks, results, rebought, rebuyWeek) {
  let count = 0;
  for (const pick of picks) {
    if (pick.team == null) continue;
    if (rebought && rebuyWeek && pick.week < rebuyWeek) continue;
    const r = results.find(
      (res) => res.week === pick.week && (res.home === pick.team || res.away === pick.team)
    );
    if (!r || !r.winner || r.winner === "TIE") continue;
    if (r.winner === pick.team) count++;
  }
  return count;
}

function formatDeadline(iso) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

async function main() {
  if (!ADMIN_PASSPHRASE || !BREVO_API_KEY || !FROM_EMAIL) {
    console.error("ADMIN_PASSPHRASE, BREVO_API_KEY and FROM_EMAIL env vars are all required.");
    process.exit(1);
  }

  const week = await rpc("current_week", {});
  if (week == null) {
    console.log("No current week (empty schedule?) — nothing to do.");
    return;
  }

  const claimed = await rpc("admin_claim_email_send", {
    p_passphrase: ADMIN_PASSPHRASE,
    p_kind: "reminder",
    p_week: week,
  });
  if (!claimed) {
    console.log(`Reminder for week ${week} already sent — skipping.`);
    return;
  }

  const [deadline, players, weekPicks, priorPicks, results] = await Promise.all([
    rpc("week_deadline", { p_week: week }),
    rpc("admin_list_players", { p_passphrase: ADMIN_PASSPHRASE }),
    sbFetch(`/rest/v1/public_picks?select=player_id&week=eq.${week}`),
    sbFetch(`/rest/v1/public_picks?select=player_id,week,team&week=lt.${week}`),
    sbFetch(`/rest/v1/results?select=week,home,away,winner`),
  ]);

  const pickedThisWeek = new Set(weekPicks.map((p) => p.player_id));
  const picksByPlayer = {};
  for (const p of priorPicks) (picksByPlayer[p.player_id] = picksByPlayer[p.player_id] || []).push(p);

  const recipients = players.filter((p) => {
    if (!p.email) return false;
    if (pickedThisWeek.has(p.id)) return false;
    const strikes = computeStrikes(picksByPlayer[p.id] || [], results, p.rebought, p.rebuy_week);
    return !isEliminated(strikes, p.rebought);
  });

  console.log(`Week ${week}: ${recipients.length} player(s) still need to pick.`);
  if (recipients.length === 0) return;

  const deadlineLabel = formatDeadline(deadline);
  for (const p of recipients) {
    const html = `
      <p>Hi ${p.name.split(" ")[0]},</p>
      <p>You haven't made your Week ${week} pick for NFL Loser Bowl yet.</p>
      <p><strong>Deadline: ${deadlineLabel}</strong> (or your team's own kickoff, if earlier).</p>
      <p><a href="${SITE_URL}pick.html">Make your pick &rarr;</a></p>
      <p>&mdash; NFL Loser Bowl</p>
    `;
    try {
      await sendEmail(BREVO_API_KEY, {
        from: FROM_EMAIL,
        to: p.email,
        subject: `Reminder: Week ${week} pick due ${deadlineLabel}`,
        html,
      });
      console.log(`Sent reminder to ${p.name} <${p.email}>`);
    } catch (err) {
      console.error(`Failed to email ${p.name}:`, err.message);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
