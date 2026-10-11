// Whether a specific pick was a strike (picked team WON — the whole point
// is picking a team you expect to lose). Cumulative strikes/elimination
// across a whole player's history live server-side now (see
// all_player_strikes() in schema.sql), since that also has to account for
// missed picks, rebuys, and when a player joined — this just classifies
// one pick's own outcome.

export function resultForPick(pick, results) {
  const r = results.find(
    (res) => res.week === pick.week && (res.home === pick.team || res.away === pick.team)
  );
  if (!r || !r.winner) return "pending";
  if (r.winner === "TIE") return "safe";
  return r.winner === pick.team ? "strike" : "safe";
}
