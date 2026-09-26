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

export async function sendEmail(apiKey, { from, to, subject, html }) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
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
