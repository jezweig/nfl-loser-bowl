// Shared Supabase REST/RPC client for the email scripts (mirrors the
// pattern in scripts/sync-results.mjs).

export const SUPABASE_URL = "https://qciggnldhwwnyjqkablv.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjaWdnbmxkaHd3bnlqcWthYmx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MzE4NDQsImV4cCI6MjEwNDIwNzg0NH0.4oBE8iybTdtVnKYHnd5JwZ-jecqX7DXDagStYP8sSfc";

// Retries once on a transient network-level failure (fetch() itself
// throwing — a dropped connection, DNS hiccup, etc.), not on an HTTP error
// response (that's a real error, not worth retrying). Seen in production:
// an ECONNRESET mid-run silently skipped a week's email because the
// script died before ever attempting a send — a short retry here is
// cheaper than relying on a human to notice and manually re-trigger.
async function fetchWithRetry(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (err) {
    console.warn(`Transient fetch error for ${url}, retrying once:`, err.message || err);
    await new Promise((r) => setTimeout(r, 1000));
    return fetch(url, opts);
  }
}

export async function sbFetch(path, opts = {}) {
  const res = await fetchWithRetry(`${SUPABASE_URL}${path}`, {
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

export async function rpc(name, body) {
  return sbFetch(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
}
