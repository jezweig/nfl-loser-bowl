// Fill these in with your Supabase project's values (Project Settings ->
// API). The "anon public" key is safe to publish in client-side code —
// it's designed for that; access is controlled by the Row Level Security
// policies and functions in supabase/schema.sql, not by hiding this key.
const SUPABASE_URL = "https://qciggnldhwwnyjqkablv.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjaWdnbmxkaHd3bnlqcWthYmx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MzE4NDQsImV4cCI6MjEwNDIwNzg0NH0.4oBE8iybTdtVnKYHnd5JwZ-jecqX7DXDagStYP8sSfc";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
