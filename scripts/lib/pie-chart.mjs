// Renders a "who picked what" pie chart as a PNG buffer, matching the
// site's dark navy theme. Small slices below OTHER_THRESHOLD are grouped
// into a single "Other" wedge so labels stay legible (per dataviz
// guidance) — the full, ungrouped breakdown belongs in the table that
// accompanies this chart in the email, not the chart itself.

import sharp from "sharp";

const SIZE = 440;
const R = 165;
const CX = SIZE / 2;
const CY = SIZE / 2;
const OTHER_THRESHOLD = 0.06; // slices under 6% get folded into "Other"

const PALETTE = [
  "#4ade80",
  "#facc15",
  "#60a5fa",
  "#f87171",
  "#c084fc",
  "#22d3ee",
  "#fb923c",
  "#a3e635",
  "#f472b6",
  "#38bdf8",
];
const OTHER_COLOR = "#64748b";

const BG = "#16213a";
const CARD_BORDER = "#24314f";

function polar(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// entries: [{ label, count }], already sorted desc by count by the caller
// (or this function will sort them). Returns a PNG Buffer.
export async function renderPieChartPng(entries) {
  const sorted = [...entries].sort((a, b) => b.count - a.count);
  const total = sorted.reduce((s, e) => s + e.count, 0);

  const main = [];
  const otherEntries = [];
  for (const e of sorted) {
    if (e.count / total < OTHER_THRESHOLD) {
      otherEntries.push(e);
    } else {
      main.push(e);
    }
  }
  // Cap distinct slices at the palette size so colors never repeat —
  // anything past that (already sorted smallest-of-the-large-slices last)
  // folds into "Other" too.
  while (main.length > PALETTE.length) {
    otherEntries.push(main.pop());
  }
  const slices = main.map((e, i) => ({ ...e, color: PALETTE[i % PALETTE.length] }));
  if (otherEntries.length > 0) {
    slices.push({
      label: `Other (${otherEntries.length})`,
      count: otherEntries.reduce((s, e) => s + e.count, 0),
      color: OTHER_COLOR,
    });
  }

  let angle = 0;
  const svgSlices = [];
  const svgLabels = [];
  for (const s of slices) {
    const sweep = (s.count / total) * 360;
    const end = angle + sweep;
    svgSlices.push(
      `<path d="${arcPath(CX, CY, R, angle, end)}" fill="${s.color}" stroke="${BG}" stroke-width="3" />`
    );
    if (sweep > 8) {
      const mid = angle + sweep / 2;
      const labelR = R * 0.62;
      const pos = polar(CX, CY, labelR, mid);
      const pct = Math.round((s.count / total) * 100);
      svgLabels.push(
        `<text x="${pos.x.toFixed(1)}" y="${pos.y.toFixed(1)}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="15" fill="#06210f">${escapeXml(s.label)}<tspan x="${pos.x.toFixed(1)}" dy="15" font-size="11" font-weight="600" opacity="0.85">${pct}%</tspan></text>`
      );
    }
    angle = end;
  }

  const svg = `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${SIZE}" height="${SIZE}" rx="20" fill="${BG}" stroke="${CARD_BORDER}" stroke-width="1"/>
    <g>${svgSlices.join("")}</g>
    <g>${svgLabels.join("")}</g>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
