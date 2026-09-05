// Shared helpers used across pick.html, history.html, standings.html and
// admin.html: date/time math (mirrors the logic in supabase/schema.sql),
// data loading from Supabase, RPC calls, session storage, and formatting.

const SESSION_KEY = "lb_session_v1";

function saveSession(player_id, name, pin) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ player_id, name, pin }));
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ---- Date/time helpers (America/New_York, DST-aware) -----------------

function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const asUTC = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const tzString = asUTC.toLocaleString("en-US", { timeZone });
  const utcString = asUTC.toLocaleString("en-US", { timeZone: "UTC" });
  const offset = new Date(utcString) - new Date(tzString);
  return new Date(asUTC.getTime() + offset);
}

function nyDateParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = {};
  fmt.formatToParts(date).forEach((p) => (parts[p.type] = p.value));
  return { y: +parts.year, m: +parts.month, d: +parts.day };
}

function formatEt(date, opts) {
  return new Intl.DateTimeFormat(
    "en-US",
    Object.assign(
      {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      },
      opts
    )
  ).format(date);
}

// The Sunday 1:00 PM ET deadline for a set of games in one week.
function weekSundayDeadline(gamesForWeek) {
  for (const g of gamesForWeek) {
    const d = new Date(g.kickoff);
    const p = nyDateParts(d);
    const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    if (wd === 0) {
      return zonedTimeToUtc(p.y, p.m, p.d, 13, 0, "America/New_York");
    }
  }
  // Fallback: shouldn't happen with a real NFL schedule.
  const maxKick = Math.max(...gamesForWeek.map((g) => new Date(g.kickoff).getTime()));
  return new Date(maxKick);
}

// The lock time for picking a specific team in a specific week: the
// earlier of that team's own kickoff, or the week's Sunday deadline.
function pickLockTime(gamesForWeek, team) {
  const game = gamesForWeek.find((g) => g.home === team || g.away === team);
  const sunday = weekSundayDeadline(gamesForWeek);
  if (!game) return sunday;
  const kickoff = new Date(game.kickoff);
  return kickoff < sunday ? kickoff : sunday;
}

function groupByWeek(games) {
  const byWeek = {};
  games.forEach((g) => {
    (byWeek[g.week] = byWeek[g.week] || []).push(g);
  });
  return byWeek;
}

// Figure out which week is "live" right now, given the full schedule.
// A week's window runs from roughly the midpoint after the previous
// week's last game through roughly 4 hours after this week's last game.
function computeCurrentWeek(now, allGames) {
  const byWeek = groupByWeek(allGames);
  const weeks = Object.keys(byWeek)
    .map(Number)
    .sort((a, b) => a - b);
  const nowMs = now.getTime();

  for (const w of weeks) {
    const kicks = byWeek[w].map((g) => new Date(g.kickoff).getTime());
    const lastEnd = Math.max(...kicks) + 4 * 3600 * 1000;
    const nextWeek = byWeek[w + 1];
    let boundary;
    if (nextWeek) {
      const nextFirst = Math.min(
        ...nextWeek.map((g) => new Date(g.kickoff).getTime())
      );
      boundary = (lastEnd + nextFirst) / 2;
    } else {
      boundary = lastEnd;
    }
    if (nowMs < boundary) return w;
  }
  return weeks[weeks.length - 1];
}

function isSeasonComplete(now, allGames) {
  const byWeek = groupByWeek(allGames);
  const weeks = Object.keys(byWeek).map(Number);
  const lastWeek = Math.max(...weeks);
  const lastEnd =
    Math.max(...byWeek[lastWeek].map((g) => new Date(g.kickoff).getTime())) +
    4 * 3600 * 1000;
  return now.getTime() > lastEnd;
}

// ---- Data loading ------------------------------------------------------

async function loadGames() {
  const { data, error } = await sb.from("games").select("*").order("kickoff");
  if (error) throw error;
  return data;
}

async function loadTeams() {
  const { data, error } = await sb.from("teams").select("*");
  if (error) throw error;
  const map = {};
  data.forEach((t) => (map[t.code] = t.name));
  return map;
}

async function loadPlayers() {
  const { data, error } = await sb
    .from("players")
    .select("id,name,slug,rebought,rebuy_week")
    .order("name");
  if (error) throw error;
  return data;
}

async function loadVisiblePicks() {
  // RLS only returns rows whose locked_at has passed.
  const { data, error } = await sb.from("picks").select("*");
  if (error) throw error;
  return data;
}

async function loadResults() {
  const { data, error } = await sb.from("results").select("*");
  if (error) throw error;
  return data;
}

// ---- RPC calls -----------------------------------------------------------

async function registerOrLogin(name, pin) {
  const { data, error } = await sb.rpc("register_or_login", {
    p_name: name,
    p_pin: pin,
  });
  if (error) throw error;
  return data[0];
}

async function submitPickRpc(playerId, pin, week, team) {
  const { data, error } = await sb.rpc("submit_pick", {
    p_player_id: playerId,
    p_pin: pin,
    p_week: week,
    p_team: team,
  });
  if (error) throw error;
  return data[0];
}

async function getMyPicksRpc(playerId, pin) {
  const { data, error } = await sb.rpc("get_my_picks", {
    p_player_id: playerId,
    p_pin: pin,
  });
  if (error) throw error;
  return data;
}

async function adminSetResultRpc(passphrase, week, home, away, winner) {
  const { error } = await sb.rpc("admin_set_result", {
    p_passphrase: passphrase,
    p_week: week,
    p_home: home,
    p_away: away,
    p_winner: winner,
  });
  if (error) throw error;
}

async function adminSetRebuyRpc(passphrase, playerId, rebought, rebuyWeek) {
  const { error } = await sb.rpc("admin_set_rebuy", {
    p_passphrase: passphrase,
    p_player_id: playerId,
    p_rebought: rebought,
    p_rebuy_week: rebuyWeek,
  });
  if (error) throw error;
}

async function adminResetPinRpc(passphrase, playerId, newPin) {
  const { error } = await sb.rpc("admin_reset_pin", {
    p_passphrase: passphrase,
    p_player_id: playerId,
    p_new_pin: newPin,
  });
  if (error) throw error;
}

// ---- Misc helpers -------------------------------------------------------

function friendlyError(err) {
  const msg = (err && err.message) || String(err || "");
  if (msg.includes("wrong_pin")) return "Incorrect PIN for that name.";
  if (msg.includes("invalid_pin")) return "PIN must be 4-8 digits.";
  if (msg.includes("invalid_name")) return "Please enter a name.";
  if (msg.includes("team_not_playing_this_week"))
    return "That team isn't playing this week.";
  if (msg.includes("past_deadline"))
    return "Too late — the deadline for that pick has passed.";
  if (msg.includes("week_already_locked"))
    return "This week is already locked in and can't be changed.";
  const dupe = msg.match(/team_already_used_week_(\d+)/);
  if (dupe) return `You already picked that team in Week ${dupe[1]}. No repeat picks.`;
  if (msg.includes("wrong_passphrase")) return "Incorrect commissioner passphrase.";
  if (msg.includes("invalid_winner")) return "Pick a valid winner for that game.";
  return msg || "Something went wrong.";
}

function computeStrikes(picks, results, rebought, rebuyWeek) {
  let count = 0;
  for (const pick of picks) {
    if (rebought && rebuyWeek && pick.week < rebuyWeek) continue;
    const result = resultForPick(pick, results);
    if (result === "strike") count++;
  }
  return count;
}

function resultForPick(pick, results) {
  const r = results.find(
    (res) =>
      res.week === pick.week &&
      (res.home === pick.team || res.away === pick.team)
  );
  if (!r || !r.winner) return "pending";
  if (r.winner === "TIE") return "safe";
  return r.winner === pick.team ? "strike" : "safe";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}
