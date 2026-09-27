// Minimal Brevo (formerly Sendinblue) transactional email client — no SDK
// dependency needed for this volume. Chosen over Resend because Brevo
// supports verifying a single sender email address directly (a
// confirmation-link click), with no domain/DNS ownership required.

// FROM_EMAIL is set as "Display Name <address@example.com>" (same format
// used everywhere else in this project); Brevo's API wants those as two
// separate fields, so split it here rather than changing the env var
// convention.
function parseFrom(fromEnv) {
  const m = fromEnv.match(/^(.*)<(.+)>$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, ""), email: m[2].trim() };
  return { email: fromEnv.trim() };
}

// Retries once on a transient network-level failure (fetch() itself
// throwing — a dropped connection, DNS hiccup, etc.), not on an HTTP error
// response (that's a real error, not worth retrying).
async function fetchWithRetry(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (err) {
    console.warn(`Transient fetch error calling Brevo, retrying once:`, err.message || err);
    await new Promise((r) => setTimeout(r, 1000));
    return fetch(url, opts);
  }
}

export async function sendEmail(apiKey, { from, to, subject, html }) {
  const res = await fetchWithRetry("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: parseFrom(from),
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Brevo send to ${to} -> ${res.status} ${text}`);
  }
  return res.status === 204 ? null : res.json();
}
