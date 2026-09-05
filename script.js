// Shared countdown logic: next NFL Loser Bowl pick deadline is every
// Sunday at 1:00 PM Eastern Time (America/New_York), DST-aware.

function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const asUTC = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const tzString = asUTC.toLocaleString("en-US", { timeZone });
  const utcString = asUTC.toLocaleString("en-US", { timeZone: "UTC" });
  const offset = new Date(utcString) - new Date(tzString);
  return new Date(asUTC.getTime() + offset);
}

function nyTodayParts(date) {
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

function getNextDeadline(now) {
  const today = nyTodayParts(now);
  const baseUTC = Date.UTC(today.y, today.m - 1, today.d);
  for (let i = 0; i < 8; i++) {
    const cand = new Date(baseUTC + i * 86400000);
    if (cand.getUTCDay() === 0) {
      const deadline = zonedTimeToUtc(
        cand.getUTCFullYear(),
        cand.getUTCMonth() + 1,
        cand.getUTCDate(),
        13,
        0,
        "America/New_York"
      );
      if (deadline.getTime() > now.getTime()) return deadline;
    }
  }
  // Fallback, should never hit.
  return new Date(now.getTime() + 7 * 86400000);
}

function formatDeadline(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function startCountdown(elIds) {
  const els = {
    days: document.getElementById(elIds.days),
    hours: document.getElementById(elIds.hours),
    minutes: document.getElementById(elIds.minutes),
    seconds: document.getElementById(elIds.seconds),
    deadlineLabel: document.getElementById(elIds.deadlineLabel),
  };

  function tick() {
    const now = new Date();
    const deadline = getNextDeadline(now);
    const diff = Math.max(0, deadline.getTime() - now.getTime());

    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    if (els.days) els.days.textContent = String(days);
    if (els.hours) els.hours.textContent = String(hours).padStart(2, "0");
    if (els.minutes) els.minutes.textContent = String(minutes).padStart(2, "0");
    if (els.seconds) els.seconds.textContent = String(seconds).padStart(2, "0");
    if (els.deadlineLabel) {
      els.deadlineLabel.textContent = formatDeadline(deadline);
    }
  }

  tick();
  return setInterval(tick, 1000);
}
