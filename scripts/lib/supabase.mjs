// Shared Supabase REST/RPC client for the email scripts (mirrors the
// pattern in scripts/sync-results.mjs).

export const SUPABASE_URL = "https://qciggnldhwwnyjqkablv.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjaWdnbmxkaHd3bnlqcWthYmx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MzE4NDQsImV4cCI6MjEwNDIwNzg0NH0.4oBE8iybTdtVnKYHnd5JwZ-jecqX7DXDagStYP8sSfc";

export async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
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
