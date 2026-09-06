#!/usr/bin/env node
// Pulls final scores from ESPN's public scoreboard API for any game past
// kickoff that doesn't have a recorded result yet, and writes them to
// Supabase via the same admin_set_result RPC admin.html uses — so results
// show up automatically without opening the admin page. Run on a schedule
// by .github/workflows/sync-results.yml (and manually via workflow_dispatch
// in the Actions tab).

const SUPABASE_URL = "https://qciggnldhwwnyjqkablv.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjaWdnbmxkaHd3bnlqcWthYmx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MzE4NDQsImV4cCI6MjEwNDIwNzg0NH0.4oBE8iybTdtVnKYHnd5JwZ-jecqX7DXDagStYP8sSfc";
const ESPN_YEAR = 2026;
const GRACE_MS = 30 * 60 * 1000; // wait 30 min past kickoff before checking a game

const ADMIN_PASSPHRASE = process.env.ADMIN_PASSPHRASE;

function gameKey(week, home, away) {
  return `${week}|${home}|${away}`;
}

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${path} -> ${res.status} ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function loadGames() {
  return sbFetch("/rest/v1/games?select=week,home,away,kickoff");
}

async function loadResults() {
  return sbFetch("/rest/v1/results?select=week,home,away,winner");
}

async function setResult(week, home, away, winner) {
  return sbFetch("/rest/v1/rpc/admin_set_result", {
    method: "POST",
    body: JSON.stringify({
      p_passphrase: ADMIN_PASSPHRASE,
      p_week: week,
      p_home: home,
      p_away: away,
      p_winner: winner,
    }),
  });
}

async function fetchEspnWeek(week, fetchImpl = fetch) {
  const res = await fetchImpl(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&year=${ESPN_YEAR}`
  );
  if (!res.ok) throw new Error(`ESPN week ${week} -> ${res.status}`);
  return res.json();
}

// Pure: given the current games/results and "now", which weeks have at
// least one game that's plausibly finished (past kickoff + grace) but has
// no recorded winner yet.
export function weeksNeedingCheck(games, results, now) {
  const decided = new Set(
    results.filter((r) => r.winner != null).map((r) => gameKey(r.week, r.home, r.away))
  );
  const weeks = new Set();
  for (const g of games) {
    if (decided.has(gameKey(g.week, g.home, g.away))) continue;
    if (new Date(g.kickoff).getTime() + GRACE_MS > now) continue;
    weeks.add(g.week);
  }
  return [...weeks].sort((a, b) => a - b);
}

// Pure: given one ESPN scoreboard response for a week and our own games
// list, return [{week, home, away, winner}] for games that are FINAL and
// not yet recorded in `results`.
export function decideResults(week, espnData, games, results) {
  const decided = new Set(
    results.filter((r) => r.winner != null).map((r) => gameKey(r.week, r.home, r.away))
  );
  const out = [];
  for (const ev of espnData.events || []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find((c) => c.homeAway === "home");
    const away = comp.competitors?.find((c) => c.homeAway === "away");
    if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;

    const homeAbbr = home.team.abbreviation;
    const awayAbbr = away.team.abbreviation;
    const key = gameKey(week, homeAbbr, awayAbbr);
    if (decided.has(key)) continue;

    const ourGame = games.find(
      (g) => g.week === week && g.home === homeAbbr && g.away === awayAbbr
    );
    if (!ourGame) {
      console.warn(`No matching game in our schedule for week ${week}: ${awayAbbr} @ ${homeAbbr}`);
      continue;
    }

    if (!ev.status?.type?.completed) continue;

    const homeScore = Number(home.score);
    const awayScore = Number(away.score);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

    const winner =
      homeScore === awayScore ? "TIE" : homeScore > awayScore ? homeAbbr : awayAbbr;

    out.push({ week, home: homeAbbr, away: awayAbbr, winner, homeScore, awayScore });
  }
  return out;
}

async function main() {
  if (!ADMIN_PASSPHRASE) {
    console.error("ADMIN_PASSPHRASE env var is required (set as a GitHub Actions secret).");
    process.exit(1);
  }

  const [games, results] = await Promise.all([loadGames(), loadResults()]);
  const weeks = weeksNeedingCheck(games, results, Date.now());

  if (weeks.length === 0) {
    console.log("No games past kickoff are waiting on a result. Nothing to check.");
    return;
  }

  console.log(`Checking ESPN for weeks: ${weeks.join(", ")}`);

  let written = 0;
  for (const week of weeks) {
    const espnData = await fetchEspnWeek(week);
    const toWrite = decideResults(week, espnData, games, results);
    for (const r of toWrite) {
      console.log(
        `Week ${r.week}: ${r.away} ${r.awayScore} @ ${r.home} ${r.homeScore} -> winner ${r.winner}`
      );
      await setResult(r.week, r.home, r.away, r.winner);
      written++;
    }
  }

  console.log(written === 0 ? "No newly-final games yet." : `Wrote ${written} result(s).`);
}

// Only run main() when executed directly (not when imported for tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
