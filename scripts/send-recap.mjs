#!/usr/bin/env node
// Emails everyone with an address on file a "who picked what" breakdown
// for the week that just closed. Runs once a week via
// .github/workflows/send-recap.yml, after the Sunday 1pm ET deadline.
// Uses admin_claim_email_send so a manual re-run never double-sends.

import { rpc, sbFetch } from "./lib/supabase.mjs";
import { sendEmail } from "./lib/brevo.mjs";

const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL;
const SITE_URL = "https://jezweig.github.io/nfl-loser-bowl/";

function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function main() {
  if (!ADMIN_PASSPHRASE || !BREVO_API_KEY || !FROM_EMAIL) {
    console.error("ADMIN_PASSPHRASE, BREVO_API_KEY and FROM_EMAIL env vars are all required.");
    process.exit(1);
  }

  const week = await rpc("last_closed_week", {});
  if (week == null) {
    console.log("No week has closed yet — nothing to recap.");
    return;
  }

  const claimed = await rpc("admin_claim_email_send", {
    p_passphrase: ADMIN_PASSPHRASE,
    p_kind: "recap",
    p_week: week,
  });
  if (!claimed) {
    console.log(`Recap for week ${week} already sent — skipping.`);
    return;
  }

  const [players, picks, teams] = await Promise.all([
    rpc("admin_list_players", { p_passphrase: ADMIN_PASSPHRASE }),
    sbFetch(`/rest/v1/public_picks?select=player_id,team&week=eq.${week}`),
    sbFetch(`/rest/v1/teams?select=code,name`),
  ]);

  const teamName = {};
  teams.forEach((t) => (teamName[t.code] = t.name));
  const playerName = {};
  players.forEach((p) => (playerName[p.id] = p.name));

  const byTeam = {};
  for (const pick of picks) {
    if (!pick.team) continue; // shouldn't happen once the deadline's passed, but be safe
    (byTeam[pick.team] = byTeam[pick.team] || []).push(playerName[pick.player_id] || "Unknown");
  }

  const rows = Object.entries(byTeam)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([code, names]) => {
      const label = teamName[code] || code;
      return `<li><strong>${escapeHtml(label)}</strong> (${names.length}): ${names
        .map(escapeHtml)
        .join(", ")}</li>`;
    })
    .join("");

  const totalPicks = picks.filter((p) => p.team).length;
  const recipients = players.filter((p) => p.email);

  console.log(`Week ${week} recap: ${totalPicks} picks, emailing ${recipients.length} player(s).`);
  if (recipients.length === 0) return;

  for (const p of recipients) {
    const html = `
      <p>Hi ${escapeHtml(p.name.split(" ")[0])},</p>
      <p>Here's who everyone picked to LOSE in Week ${week} (${totalPicks} picks locked in):</p>
      <ul>${rows}</ul>
      <p><a href="${SITE_URL}standings.html">See full standings &rarr;</a></p>
      <p>&mdash; NFL Loser Bowl</p>
    `;
    try {
      await sendEmail(BREVO_API_KEY, {
        from: FROM_EMAIL,
        to: p.email,
        subject: `Week ${week} recap: who picked what`,
        html,
      });
      console.log(`Sent recap to ${p.name} <${p.email}>`);
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
