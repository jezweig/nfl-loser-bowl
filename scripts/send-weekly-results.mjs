#!/usr/bin/env node
// Email #4: weekly results — sent once every game in a week has a
// recorded winner (not on a fixed clock time, since the last game of a
// week varies: Monday Night Football most weeks, but Thanksgiving/holiday
// weeks and bye-adjusted schedules differ). Runs hourly (see
// .github/workflows/send-weekly-results.yml), right after
// sync-results.mjs would have recorded that day's final scores.
// admin_claim_email_send guarantees at most one send per week; unlike the
// other three scripts, this one checks every not-yet-sent closed week each
// run (not just the latest), so a missed window still catches up on the
// next run instead of silently skipping a week.

import { rpc, sbFetch } from "./lib/supabase.mjs";
import { sendEmail } from "./lib/brevo.mjs";
import { computeStrikes, isEliminated, resultForPick } from "./lib/pool-logic.mjs";
import { wrapEmail, dataTable, escapeHtml, COLORS } from "./lib/email-template.mjs";

const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL;
const SITE_URL = "https://jezweig.github.io/nfl-loser-bowl/";

function gameKey(week, home, away) {
  return `${week}|${home}|${away}`;
}

// Pure: which past (deadline-passed) weeks have every game decided.
export function weeksReadyForResults(games, results, lastClosedWeek) {
  const decided = new Set(
    results.filter((r) => r.winner != null).map((r) => gameKey(r.week, r.home, r.away))
  );
  const byWeek = {};
  for (const g of games) {
    if (g.week > lastClosedWeek) continue;
    (byWeek[g.week] = byWeek[g.week] || []).push(g);
  }
  return Object.keys(byWeek)
    .map(Number)
    .filter((week) => byWeek[week].every((g) => decided.has(gameKey(week, g.home, g.away))))
    .sort((a, b) => a - b);
}

async function main() {
  if (!ADMIN_PASSPHRASE || !BREVO_API_KEY || !FROM_EMAIL) {
    console.error("ADMIN_PASSPHRASE, BREVO_API_KEY and FROM_EMAIL env vars are all required.");
    process.exit(1);
  }

  const lastClosedWeek = await rpc("last_closed_week", {});
  if (lastClosedWeek == null) {
    console.log("No week has closed yet — nothing to report.");
    return;
  }

  const [games, results, teams, players, allPicks] = await Promise.all([
    sbFetch(`/rest/v1/games?select=week,home,away,kickoff`),
    sbFetch(`/rest/v1/results?select=week,home,away,winner`),
    sbFetch(`/rest/v1/teams?select=code,name`),
    rpc("admin_list_players", { p_passphrase: ADMIN_PASSPHRASE }),
    sbFetch(`/rest/v1/public_picks?select=player_id,week,team`),
  ]);

  const teamName = {};
  teams.forEach((t) => (teamName[t.code] = t.name));
  const picksByPlayer = {};
  for (const p of allPicks) (picksByPlayer[p.player_id] = picksByPlayer[p.player_id] || []).push(p);

  const readyWeeks = weeksReadyForResults(games, results, lastClosedWeek);
  console.log(`Weeks with every game decided: ${readyWeeks.join(", ") || "none"}.`);

  for (const week of readyWeeks) {
    const claimed = await rpc("admin_claim_email_send", {
      p_passphrase: ADMIN_PASSPHRASE,
      p_kind: "weekly_results",
      p_week: week,
    });
    if (!claimed) {
      console.log(`Week ${week} results already sent — skipping.`);
      continue;
    }
    await sendResultsForWeek(week, { games, results, teams, teamName, players, picksByPlayer, allPicks });
  }
}

async function sendResultsForWeek(week, { games, results, teamName, players, picksByPlayer, allPicks }) {
  const weekGames = games.filter((g) => g.week === week);
  const weekResults = results.filter((r) => r.week === week);

  const gameRows = weekGames
    .map((g) => {
      const r = weekResults.find((res) => res.home === g.home && res.away === g.away);
      const winnerLabel =
        r?.winner === "TIE" ? "Tie" : r?.winner ? teamName[r.winner] || r.winner : "&mdash;";
      return [
        escapeHtml(`${teamName[g.away] || g.away} @ ${teamName[g.home] || g.home}`),
        `<strong style="color:${COLORS.gold};">${escapeHtml(winnerLabel)}</strong>`,
      ];
    });
  const gamesResultTable = dataTable(["Matchup", "Winner"], gameRows);

  // Everyone whose Week-`week` pick turned out to be a strike (their
  // picked team WON), plus their status after this week's result.
  const strikeRows = [];
  for (const p of players) {
    const weekPick = (picksByPlayer[p.id] || []).find((pk) => pk.week === week);
    if (!weekPick || weekPick.team == null) continue;
    if (resultForPick(weekPick, results) !== "strike") continue;
    const strikesNow = computeStrikes(picksByPlayer[p.id] || [], results, p.rebought, p.rebuy_week);
    const eliminated = isEliminated(strikesNow, p.rebought);
    strikeRows.push([
      escapeHtml(p.name),
      escapeHtml(teamName[weekPick.team] || weekPick.team),
      eliminated
        ? `<strong style="color:${COLORS.danger};">Eliminated</strong>`
        : `<span style="color:${COLORS.warn};">${strikesNow} strike${strikesNow === 1 ? "" : "s"}</span>`,
    ]);
  }
  const strikesTable =
    strikeRows.length > 0
      ? dataTable(["Player", "Picked (lost the bet)", "Status"], strikeRows)
      : `<p style="margin:0 0 16px;font-size:14px;color:${COLORS.accent};">Nobody got hit this week &mdash; a clean week for the whole pool.</p>`;

  const remaining = players.filter((p) => {
    const strikesNow = computeStrikes(picksByPlayer[p.id] || [], results, p.rebought, p.rebuy_week);
    return !isEliminated(strikesNow, p.rebought);
  }).length;

  const bodyHtmlFor = (firstName) => `
    <p style="margin:0 0 14px;font-size:16px;">Hi ${escapeHtml(firstName)},</p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.5;">
      Week ${week} is in the books. <strong>${remaining}</strong> player${remaining === 1 ? "" : "s"} remain${remaining === 1 ? "s" : ""} in the pool.
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:${COLORS.textDim};text-transform:uppercase;letter-spacing:.04em;">Results</p>
    ${gamesResultTable}
    <p style="margin:20px 0 8px;font-size:13px;color:${COLORS.textDim};text-transform:uppercase;letter-spacing:.04em;">This week's strikes</p>
    ${strikesTable}
    <p style="margin:20px 0 0;">
      <a href="${SITE_URL}standings.html" style="color:${COLORS.accent};font-size:14px;text-decoration:none;">See full standings &rarr;</a>
    </p>
  `;

  const recipients = players.filter((p) => p.email);
  console.log(`Week ${week} results: ${recipients.length} recipient(s), ${strikeRows.length} strike(s), ${remaining} remaining.`);

  for (const p of recipients) {
    const html = wrapEmail({
      title: `Week ${week} results`,
      preheader: `${remaining} players remain after Week ${week}.`,
      bodyHtml: bodyHtmlFor(p.name.split(" ")[0]),
    });
    try {
      await sendEmail(BREVO_API_KEY, {
        from: FROM_EMAIL,
        to: p.email,
        subject: `Week ${week} results: ${strikeRows.length} struck out`,
        html,
      });
      console.log(`Sent Week ${week} results to ${p.name} <${p.email}>`);
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
