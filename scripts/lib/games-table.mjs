import { dataTable, escapeHtml } from "./email-template.mjs";

function formatKickoff(iso) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

// weekGames: [{home, away, kickoff}], teamName: {code: fullName}
export function gamesTable(weekGames, teamName) {
  const sorted = [...weekGames].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const rows = sorted.map((g) => [
    escapeHtml(`${teamName[g.away] || g.away} @ ${teamName[g.home] || g.home}`),
    escapeHtml(formatKickoff(g.kickoff)),
  ]);
  return dataTable(["Matchup", "Kickoff (ET)"], rows);
}
