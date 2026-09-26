// Shared branded email wrapper — echoes the site's dark navy theme
// (style.css tokens) using an email-safe, table-based layout (no
// flexbox/grid, no external stylesheet dependency, every style inlined).
//
// The email is deliberately dark, not just "dark on the site but left to
// each client's whim" — the color-scheme meta tags below tell clients that
// support them ("this email IS dark, don't auto-invert it") rather than
// leaving it to a client's own dark-mode reprocessing, which can otherwise
// double-invert a manually-dark design into something unreadable.

export const COLORS = {
  bg: "#0b1220",
  card: "#16213a",
  cardBorder: "#24314f",
  text: "#eef1f8",
  textDim: "#9aa7c2",
  accent: "#4ade80",
  danger: "#f87171",
  warn: "#fbbf24",
  gold: "#facc15",
};

const FONT = "Arial, Helvetica, sans-serif";
const SITE_URL = "https://jezweig.github.io/nfl-loser-bowl/";

export function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Builds a simple, email-safe bordered table. `headers`: string[].
// `rows`: string[][] of already-escaped/formatted HTML cell contents.
export function dataTable(headers, rows, { align } = {}) {
  const th = headers
    .map(
      (h, i) =>
        `<th align="${(align && align[i]) || "left"}" style="padding:8px 12px;border-bottom:2px solid ${COLORS.cardBorder};color:${COLORS.textDim};font-size:12px;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(h)}</th>`
    )
    .join("");
  const trs = rows
    .map(
      (cells, ri) =>
        `<tr>${cells
          .map(
            (c, i) =>
              `<td align="${(align && align[i]) || "left"}" style="padding:8px 12px;border-bottom:1px solid ${COLORS.cardBorder};color:${COLORS.text};font-size:14px;${ri === rows.length - 1 ? "border-bottom:none;" : ""}">${c}</td>`
          )
          .join("")}</tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:16px 0;">
    <thead><tr>${th}</tr></thead>
    <tbody>${trs}</tbody>
  </table>`;
}

export function button(label, href) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
    <tr><td bgcolor="${COLORS.accent}" style="border-radius:8px;">
      <a href="${href}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;font-weight:bold;color:#06210f;text-decoration:none;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

export function wrapEmail({ preheader = "", title, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COLORS.bg}" style="background-color:${COLORS.bg};">
<tr><td align="center" style="padding:24px 16px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
    <tr><td align="center" style="padding-bottom:16px;font-family:${FONT};font-size:13px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${COLORS.textDim};">
      🏈 NFL Loser Bowl &middot; 2026 Season
    </td></tr>
    <tr><td bgcolor="${COLORS.card}" style="background-color:${COLORS.card};border:1px solid ${COLORS.cardBorder};border-radius:16px;padding:28px;font-family:${FONT};color:${COLORS.text};">
      ${bodyHtml}
    </td></tr>
    <tr><td align="center" style="padding-top:20px;font-family:${FONT};font-size:12px;color:${COLORS.textDim};">
      <a href="${SITE_URL}" style="color:${COLORS.accent};text-decoration:none;">jezweig.github.io/nfl-loser-bowl</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
