#!/usr/bin/env node
// Email #3: pick summary — pie chart + full per-team table of who picked
// what, sent Sunday 1:30 PM ET (30 min after the deadline). Runs hourly
// (see .github/workflows/send-pick-summary.yml); the DB-computed
// pick_summary_time() gate (DST-safe) decides the real send moment.
// admin_claim_email_send guarantees at most one send per week.
//
// Email clients don't run JS and inconsistently support inline <svg>, so
// the chart is rendered to a PNG and referenced by a normal hosted <img
// src>, the one approach that works everywhere. This script only writes
// that PNG to email-assets/week-<N>-picks.png in the checked-out repo —
// the workflow commits and pushes it (see the "Commit chart image" step),
// so GitHub Pages serves it at a real, permanent URL before any recipient
// opens the email. Per-week filenames (never overwritten) mean an old
// email always shows its own week's chart, not a later week's.

import { rpc, sbFetch } from "./lib/supabase.mjs";
import { sendEmail } from "./lib/brevo.mjs";
import { wrapEmail, dataTable, escapeHtml, COLORS } from "./lib/email-template.mjs";
import { renderPieChartPng } from "./lib/pie-chart.mjs";
import { writeFile, mkdir } from "node:fs/promises";

const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL;
const SITE_URL = "https://jezweig.github.io/nfl-loser-bowl/";
const CHART_DIR = "email-assets";

async function main() {
  if (!ADMIN_PASSPHRASE || !BREVO_API_KEY || !FROM_EMAIL) {
    console.error("ADMIN_PASSPHRASE, BREVO_API_KEY and FROM_EMAIL env vars are all required.");
    process.exit(1);
  }

  const week = await rpc("last_closed_week", {});
  if (week == null) {
    console.log("No week has closed yet — nothing to summarize.");
    return;
  }

  const gate = await rpc("pick_summary_time", { p_week: week });
  if (new Date(gate).getTime() > Date.now()) {
    console.log(`Week ${week}: not yet ${gate} (Sunday 1:30pm ET gate) — skipping.`);
    return;
  }

  const claimed = await rpc("admin_claim_email_send", {
    p_passphrase: ADMIN_PASSPHRASE,
    p_kind: "pick_summary",
    p_week: week,
  });
  if (!claimed) {
    console.log(`Week ${week} pick summary already sent — skipping.`);
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

  const totalPicks = picks.filter((p) => p.team).length;
  if (totalPicks === 0) {
    console.log(`Week ${week}: no picks recorded — skipping (nothing to chart).`);
    return;
  }

  const chartData = Object.entries(byTeam).map(([code, names]) => ({
    label: code,
    count: names.length,
  }));
  const pngBuffer = await renderPieChartPng(chartData);

  await mkdir(CHART_DIR, { recursive: true });
  const chartPath = `${CHART_DIR}/week-${week}-picks.png`;
  await writeFile(chartPath, pngBuffer);
  console.log(`Wrote chart to ${chartPath} (${pngBuffer.length} bytes).`);
  const chartUrl = `${SITE_URL}${chartPath}`;

  const tableRows = Object.entries(byTeam)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([code, names]) => [
      `<strong>${escapeHtml(teamName[code] || code)}</strong>`,
      String(names.length),
      escapeHtml(names.slice().sort().join(", ")),
    ]);
  const table = dataTable(["Team", "#", "Picked by"], tableRows, { align: ["left", "center", "left"] });

  const recipients = players.filter((p) => p.email);
  console.log(`Week ${week} pick summary: ${totalPicks} picks, emailing ${recipients.length} player(s).`);
  if (recipients.length === 0) return;

  for (const p of recipients) {
    const bodyHtml = `
      <p style="margin:0 0 14px;font-size:16px;">Hi ${escapeHtml(p.name.split(" ")[0])},</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.5;">
        Here's who everyone picked to <strong>LOSE</strong> in Week ${week}
        (${totalPicks} picks locked in):
      </p>
      <img src="${chartUrl}" width="440" alt="Week ${week} pick breakdown pie chart" style="display:block;width:100%;max-width:440px;height:auto;margin:0 auto 18px;border-radius:16px;" />
      ${table}
      <p style="margin:20px 0 0;">
        <a href="${SITE_URL}standings.html" style="color:${COLORS.accent};font-size:14px;text-decoration:none;">See full standings &rarr;</a>
      </p>
    `;
    const html = wrapEmail({
      title: `Week ${week} pick summary`,
      preheader: `Who picked what in Week ${week} — ${totalPicks} picks.`,
      bodyHtml,
    });
    try {
      await sendEmail(BREVO_API_KEY, {
        from: FROM_EMAIL,
        to: p.email,
        subject: `Week ${week} pick summary: who picked what`,
        html,
      });
      console.log(`Sent pick summary to ${p.name} <${p.email}>`);
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
