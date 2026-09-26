// Shared strike/elimination logic — mirrors computeStrikes/isEliminated in
// app.js exactly (same win/lose semantics: a "strike" is when the picked
// team WON, since the whole point is picking a team you expect to lose).

export function isEliminated(strikes, rebought) {
  return rebought ? strikes >= 1 : strikes >= 2;
}

// picks: [{week, team}] — only ever call with already-locked (fully
// revealed) picks.
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

export function resultForPick(pick, results) {
  const r = results.find(
    (res) => res.week === pick.week && (res.home === pick.team || res.away === pick.team)
  );
  if (!r || !r.winner) return "pending";
  if (r.winner === "TIE") return "safe";
  return r.winner === pick.team ? "strike" : "safe";
}
