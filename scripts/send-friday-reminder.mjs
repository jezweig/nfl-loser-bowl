#!/usr/bin/env node
// Email #1: early heads-up to everyone still in the pool — Friday 1:00 PM
// ET, regardless of whether they've already picked (that's what
// distinguishes it from send-sunday-reminder.mjs's last-call, non-pickers-
// only nudge). Runs hourly (see .github/workflows/send-friday-reminder.yml);
// the DB-computed friday_reminder_time() gate (DST-safe) decides the real
// send moment. admin_claim_email_send guarantees at most one send per week.

import { rpc, sbFetch } from "./lib/supabase.mjs";
import { sendEmail } from "./lib/brevo.mjs";
import { computeStrikes, isEliminated } from "./lib/pool-logic.mjs";
import { wrapEmail, button, COLORS } from "./lib/email-template.mjs";
import { gamesTable } from "./lib/games-table.mjs";

const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL;
const SITE_URL = "https://jezweig.github.io/nfl-loser-bowl/";

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

  const gate = await rpc("friday_reminder_time", { p_week: week });
  if (new Date(gate).getTime() > Date.now()) {
    console.log(`Week ${week}: not yet ${gate} (Friday 1pm ET gate) — skipping.`);
    return;
  }

  const [deadline, players, weekGames, teams, weekPicks, priorPicks, results] = await Promise.all([
    rpc("week_deadline", { p_week: week }),
    rpc("admin_list_players", { p_passphrase: ADMIN_PASSPHRASE }),
    sbFetch(`/rest/v1/games?select=home,away,kickoff&week=eq.${week}`),
    sbFetch(`/rest/v1/teams?select=code,name`),
    sbFetch(`/rest/v1/public_picks?select=player_id&week=eq.${week}`),
    sbFetch(`/rest/v1/public_picks?select=player_id,week,team&week=lt.${week}`),
    sbFetch(`/rest/v1/results?select=week,home,away,winner`),
  ]);

  const teamName = {};
  teams.forEach((t) => (teamName[t.code] = t.name));

  const pickedThisWeek = new Set(weekPicks.map((p) => p.player_id));
  const picksByPlayer = {};
  for (const p of priorPicks) (picksByPlayer[p.player_id] = picksByPlayer[p.player_id] || []).push(p);

  const recipients = players.filter((p) => {
    if (!p.email) return false;
    const strikes = computeStrikes(picksByPlayer[p.id] || [], results, p.rebought, p.rebuy_week);
    return !isEliminated(strikes, p.rebought);
  });

  console.log(`Week ${week}: emailing ${recipients.length} active player(s) the Friday heads-up.`);

  // Claim only now, once every network call needed to build the send has
  // already succeeded — claiming any earlier risks marking the week
  // "sent" even though a transient failure (e.g. a dropped connection)
  // meant nothing actually went out.
  const claimed = await rpc("admin_claim_email_send", {
    p_passphrase: ADMIN_PASSPHRASE,
    p_kind: "friday_all",
    p_week: week,
  });
  if (!claimed) {
    console.log(`Week ${week} Friday reminder already sent — skipping.`);
    return;
  }
  if (recipients.length === 0) return;

  const deadlineLabel = formatDeadline(deadline);
  const games = gamesTable(weekGames, teamName);

  for (const p of recipients) {
    const alreadyPicked = pickedThisWeek.has(p.id);
    const statusHtml = alreadyPicked
      ? `<p style="margin:0 0 14px;font-size:15px;color:${COLORS.accent};">You're already picked for Week ${week} — nothing else to do. This is just your weekly heads-up.</p>`
      : `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;">You haven't picked yet for <strong>Week ${week}</strong>.</p>`;
    const bodyHtml = `
      <p style="margin:0 0 14px;font-size:16px;">Hi ${p.name.split(" ")[0]},</p>
      ${statusHtml}
      <p style="margin:0 0 14px;font-size:15px;">
        Deadline: <strong>${deadlineLabel}</strong> (or your team's own kickoff, if earlier).
      </p>
      ${button(alreadyPicked ? "Review or change your pick" : "Make your pick", `${SITE_URL}pick.html`)}
      <p style="margin:20px 0 8px;font-size:13px;color:${COLORS.textDim};text-transform:uppercase;letter-spacing:.04em;">This week's games</p>
      ${games}
    `;
    const html = wrapEmail({
      title: `Week ${week} pick reminder`,
      preheader: `Deadline ${deadlineLabel}.`,
      bodyHtml,
    });
    try {
      await sendEmail(BREVO_API_KEY, {
        from: FROM_EMAIL,
        to: p.email,
        subject: `NFL Loser Bowl: Week ${week} picks due ${deadlineLabel}`,
        html,
      });
      console.log(`Sent Friday reminder to ${p.name} <${p.email}>`);
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
