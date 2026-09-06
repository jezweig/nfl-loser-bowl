-- NFL Loser Bowl 2026 — Supabase schema
--
-- HOW TO USE:
-- 1. Open your Supabase project -> SQL Editor -> New query.
-- 2. Before running, find the line near the bottom that sets the
--    commissioner passphrase (search for CHANGE_ME_ADMIN_PASSPHRASE) and
--    replace it with your own passphrase. Do NOT commit your real
--    passphrase to git — edit it only in the Supabase SQL editor, or in a
--    local copy of this file that you don't commit.
-- 3. Run the whole script once. Re-running is safe (uses IF NOT EXISTS /
--    CREATE OR REPLACE) except the admin passphrase seed, which only
--    inserts if the admin_config row doesn't already exist.
--
-- SECURITY MODEL:
-- - Players authenticate with a name + a self-chosen PIN (no email/password
--   needed). PINs are hashed with bcrypt (pgcrypto) — never stored plain.
-- - All writes (submitting a pick, recording a result, buyback/rebuy) go
--   through SECURITY DEFINER functions below, which verify the PIN or the
--   commissioner passphrase server-side before touching any data. Direct
--   table INSERT/UPDATE from the browser is not permitted.
-- - A pick becomes publicly readable (to everyone, not just its owner)
--   only once its lock time has passed — enforced by a Postgres Row Level
--   Security policy using the game's real kickoff time, computed from the
--   `games` table below. Before that, only the owning player (via PIN)
--   can read their own pick.

create extension if not exists pgcrypto with schema extensions;

-- ── Reference schedule ──────────────────────────────────────────────
-- Full 2026 regular-season schedule (all 18 weeks), pulled from the NFL's
-- published schedule. Kickoff times for weeks with times still "TBD" this
-- far out (notably some late-season games) may need a manual update
-- closer to those weeks — see the UPDATE example at the bottom of this
-- file.

create table if not exists games (
  id bigserial primary key,
  week int not null,
  home text not null,
  away text not null,
  kickoff timestamptz not null,
  unique (week, home, away)
);

truncate table games restart identity;

insert into games (week, home, away, kickoff) values
(1, 'SEA', 'NE', '2026-09-10T00:20Z'::timestamptz),
(1, 'LAR', 'SF', '2026-09-11T00:35Z'::timestamptz),
(1, 'CIN', 'TB', '2026-09-13T17:00Z'::timestamptz),
(1, 'DET', 'NO', '2026-09-13T17:00Z'::timestamptz),
(1, 'TEN', 'NYJ', '2026-09-13T17:00Z'::timestamptz),
(1, 'IND', 'BAL', '2026-09-13T17:00Z'::timestamptz),
(1, 'PIT', 'ATL', '2026-09-13T17:00Z'::timestamptz),
(1, 'CAR', 'CHI', '2026-09-13T17:00Z'::timestamptz),
(1, 'JAX', 'CLE', '2026-09-13T17:00Z'::timestamptz),
(1, 'HOU', 'BUF', '2026-09-13T17:00Z'::timestamptz),
(1, 'LV', 'MIA', '2026-09-13T20:25Z'::timestamptz),
(1, 'MIN', 'GB', '2026-09-13T20:25Z'::timestamptz),
(1, 'PHI', 'WSH', '2026-09-13T20:25Z'::timestamptz),
(1, 'LAC', 'ARI', '2026-09-13T20:25Z'::timestamptz),
(1, 'NYG', 'DAL', '2026-09-14T00:20Z'::timestamptz),
(1, 'KC', 'DEN', '2026-09-15T00:15Z'::timestamptz),
(2, 'BUF', 'DET', '2026-09-18T00:15Z'::timestamptz),
(2, 'ATL', 'CAR', '2026-09-20T17:00Z'::timestamptz),
(2, 'CHI', 'MIN', '2026-09-20T17:00Z'::timestamptz),
(2, 'TEN', 'PHI', '2026-09-20T17:00Z'::timestamptz),
(2, 'NE', 'PIT', '2026-09-20T17:00Z'::timestamptz),
(2, 'NYJ', 'GB', '2026-09-20T17:00Z'::timestamptz),
(2, 'TB', 'CLE', '2026-09-20T17:00Z'::timestamptz),
(2, 'BAL', 'NO', '2026-09-20T17:00Z'::timestamptz),
(2, 'HOU', 'CIN', '2026-09-20T17:00Z'::timestamptz),
(2, 'DEN', 'JAX', '2026-09-20T20:05Z'::timestamptz),
(2, 'LAC', 'LV', '2026-09-20T20:05Z'::timestamptz),
(2, 'DAL', 'WSH', '2026-09-20T20:25Z'::timestamptz),
(2, 'ARI', 'SEA', '2026-09-20T20:25Z'::timestamptz),
(2, 'SF', 'MIA', '2026-09-20T20:25Z'::timestamptz),
(2, 'KC', 'IND', '2026-09-21T00:20Z'::timestamptz),
(2, 'LAR', 'NYG', '2026-09-22T00:15Z'::timestamptz),
(3, 'GB', 'ATL', '2026-09-25T00:15Z'::timestamptz),
(3, 'BUF', 'LAC', '2026-09-27T17:00Z'::timestamptz),
(3, 'CLE', 'CAR', '2026-09-27T17:00Z'::timestamptz),
(3, 'DET', 'NYJ', '2026-09-27T17:00Z'::timestamptz),
(3, 'IND', 'HOU', '2026-09-27T17:00Z'::timestamptz),
(3, 'MIA', 'KC', '2026-09-27T17:00Z'::timestamptz),
(3, 'NYG', 'TEN', '2026-09-27T17:00Z'::timestamptz),
(3, 'PIT', 'CIN', '2026-09-27T17:00Z'::timestamptz),
(3, 'WSH', 'SEA', '2026-09-27T17:00Z'::timestamptz),
(3, 'JAX', 'NE', '2026-09-27T17:00Z'::timestamptz),
(3, 'SF', 'ARI', '2026-09-27T20:05Z'::timestamptz),
(3, 'TB', 'MIN', '2026-09-27T20:05Z'::timestamptz),
(3, 'DAL', 'BAL', '2026-09-27T20:25Z'::timestamptz),
(3, 'NO', 'LV', '2026-09-27T20:25Z'::timestamptz),
(3, 'DEN', 'LAR', '2026-09-28T00:20Z'::timestamptz),
(3, 'CHI', 'PHI', '2026-09-29T00:15Z'::timestamptz),
(4, 'CLE', 'PIT', '2026-10-02T00:15Z'::timestamptz),
(4, 'WSH', 'IND', '2026-10-04T13:30Z'::timestamptz),
(4, 'BUF', 'NE', '2026-10-04T17:00Z'::timestamptz),
(4, 'CHI', 'NYJ', '2026-10-04T17:00Z'::timestamptz),
(4, 'CIN', 'JAX', '2026-10-04T17:00Z'::timestamptz),
(4, 'NYG', 'ARI', '2026-10-04T17:00Z'::timestamptz),
(4, 'PHI', 'LAR', '2026-10-04T17:00Z'::timestamptz),
(4, 'TB', 'GB', '2026-10-04T17:00Z'::timestamptz),
(4, 'BAL', 'TEN', '2026-10-04T17:00Z'::timestamptz),
(4, 'HOU', 'DAL', '2026-10-04T17:00Z'::timestamptz),
(4, 'MIN', 'MIA', '2026-10-04T20:05Z'::timestamptz),
(4, 'LV', 'KC', '2026-10-04T20:25Z'::timestamptz),
(4, 'SF', 'DEN', '2026-10-04T20:25Z'::timestamptz),
(4, 'SEA', 'LAC', '2026-10-04T20:25Z'::timestamptz),
(4, 'CAR', 'DET', '2026-10-05T00:20Z'::timestamptz),
(4, 'NO', 'ATL', '2026-10-06T00:15Z'::timestamptz),
(5, 'DAL', 'TB', '2026-10-09T00:15Z'::timestamptz),
(5, 'JAX', 'PHI', '2026-10-11T13:30Z'::timestamptz),
(5, 'TEN', 'HOU', '2026-10-11T17:00Z'::timestamptz),
(5, 'MIA', 'CIN', '2026-10-11T17:00Z'::timestamptz),
(5, 'NE', 'LV', '2026-10-11T17:00Z'::timestamptz),
(5, 'NO', 'MIN', '2026-10-11T17:00Z'::timestamptz),
(5, 'NYJ', 'CLE', '2026-10-11T17:00Z'::timestamptz),
(5, 'PIT', 'IND', '2026-10-11T17:00Z'::timestamptz),
(5, 'WSH', 'NYG', '2026-10-11T17:00Z'::timestamptz),
(5, 'LAC', 'DEN', '2026-10-11T20:05Z'::timestamptz),
(5, 'GB', 'CHI', '2026-10-11T20:25Z'::timestamptz),
(5, 'ARI', 'DET', '2026-10-11T20:25Z'::timestamptz),
(5, 'SEA', 'SF', '2026-10-11T20:25Z'::timestamptz),
(5, 'ATL', 'BAL', '2026-10-12T00:20Z'::timestamptz),
(5, 'LAR', 'BUF', '2026-10-13T00:15Z'::timestamptz),
(6, 'DEN', 'SEA', '2026-10-16T00:15Z'::timestamptz),
(6, 'JAX', 'HOU', '2026-10-18T13:30Z'::timestamptz),
(6, 'ATL', 'CHI', '2026-10-18T17:00Z'::timestamptz),
(6, 'CLE', 'BAL', '2026-10-18T17:00Z'::timestamptz),
(6, 'IND', 'TEN', '2026-10-18T17:00Z'::timestamptz),
(6, 'NE', 'NYJ', '2026-10-18T17:00Z'::timestamptz),
(6, 'NYG', 'NO', '2026-10-18T17:00Z'::timestamptz),
(6, 'PHI', 'CAR', '2026-10-18T17:00Z'::timestamptz),
(6, 'TB', 'PIT', '2026-10-18T17:00Z'::timestamptz),
(6, 'LAR', 'ARI', '2026-10-18T20:05Z'::timestamptz),
(6, 'KC', 'LAC', '2026-10-18T20:25Z'::timestamptz),
(6, 'LV', 'BUF', '2026-10-18T20:25Z'::timestamptz),
(6, 'GB', 'DAL', '2026-10-19T00:20Z'::timestamptz),
(6, 'SF', 'WSH', '2026-10-20T00:15Z'::timestamptz),
(7, 'CHI', 'NE', '2026-10-23T00:15Z'::timestamptz),
(7, 'NO', 'PIT', '2026-10-25T13:30Z'::timestamptz),
(7, 'ATL', 'SF', '2026-10-25T17:00Z'::timestamptz),
(7, 'TEN', 'CLE', '2026-10-25T17:00Z'::timestamptz),
(7, 'MIN', 'IND', '2026-10-25T17:00Z'::timestamptz),
(7, 'NYJ', 'MIA', '2026-10-25T17:00Z'::timestamptz),
(7, 'CAR', 'TB', '2026-10-25T17:00Z'::timestamptz),
(7, 'BAL', 'CIN', '2026-10-25T17:00Z'::timestamptz),
(7, 'HOU', 'NYG', '2026-10-25T17:00Z'::timestamptz),
(7, 'ARI', 'DEN', '2026-10-25T20:05Z'::timestamptz),
(7, 'DET', 'GB', '2026-10-25T20:25Z'::timestamptz),
(7, 'LV', 'LAR', '2026-10-25T20:25Z'::timestamptz),
(7, 'SEA', 'KC', '2026-10-26T00:20Z'::timestamptz),
(7, 'PHI', 'DAL', '2026-10-27T00:15Z'::timestamptz),
(8, 'GB', 'CAR', '2026-10-30T00:15Z'::timestamptz),
(8, 'BUF', 'BAL', '2026-11-01T18:00Z'::timestamptz),
(8, 'CIN', 'TEN', '2026-11-01T18:00Z'::timestamptz),
(8, 'DAL', 'ARI', '2026-11-01T18:00Z'::timestamptz),
(8, 'DET', 'MIN', '2026-11-01T18:00Z'::timestamptz),
(8, 'NYJ', 'LV', '2026-11-01T18:00Z'::timestamptz),
(8, 'PIT', 'CLE', '2026-11-01T18:00Z'::timestamptz),
(8, 'TB', 'ATL', '2026-11-01T18:00Z'::timestamptz),
(8, 'JAX', 'IND', '2026-11-01T18:00Z'::timestamptz),
(8, 'LAR', 'LAC', '2026-11-01T21:05Z'::timestamptz),
(8, 'DEN', 'KC', '2026-11-01T21:25Z'::timestamptz),
(8, 'MIA', 'NE', '2026-11-01T21:25Z'::timestamptz),
(8, 'WSH', 'PHI', '2026-11-02T01:20Z'::timestamptz),
(8, 'SEA', 'CHI', '2026-11-03T01:15Z'::timestamptz),
(9, 'BAL', 'JAX', '2026-11-06T01:15Z'::timestamptz),
(9, 'ATL', 'CIN', '2026-11-08T14:30Z'::timestamptz),
(9, 'IND', 'DAL', '2026-11-08T18:00Z'::timestamptz),
(9, 'KC', 'NYJ', '2026-11-08T18:00Z'::timestamptz),
(9, 'MIA', 'DET', '2026-11-08T18:00Z'::timestamptz),
(9, 'NO', 'CLE', '2026-11-08T18:00Z'::timestamptz),
(9, 'PHI', 'NYG', '2026-11-08T18:00Z'::timestamptz),
(9, 'WSH', 'LAR', '2026-11-08T18:00Z'::timestamptz),
(9, 'CAR', 'DEN', '2026-11-08T18:00Z'::timestamptz),
(9, 'LAC', 'HOU', '2026-11-08T21:05Z'::timestamptz),
(9, 'SF', 'LV', '2026-11-08T21:05Z'::timestamptz),
(9, 'NE', 'GB', '2026-11-08T21:25Z'::timestamptz),
(9, 'SEA', 'ARI', '2026-11-08T21:25Z'::timestamptz),
(9, 'CHI', 'TB', '2026-11-09T01:20Z'::timestamptz),
(9, 'MIN', 'BUF', '2026-11-10T01:15Z'::timestamptz),
(10, 'NYG', 'WSH', '2026-11-13T01:15Z'::timestamptz),
(10, 'DET', 'NE', '2026-11-15T14:30Z'::timestamptz),
(10, 'ATL', 'KC', '2026-11-15T18:00Z'::timestamptz),
(10, 'CLE', 'HOU', '2026-11-15T18:00Z'::timestamptz),
(10, 'GB', 'MIN', '2026-11-15T18:00Z'::timestamptz),
(10, 'TEN', 'JAX', '2026-11-15T18:00Z'::timestamptz),
(10, 'IND', 'MIA', '2026-11-15T18:00Z'::timestamptz),
(10, 'NO', 'CAR', '2026-11-15T18:00Z'::timestamptz),
(10, 'NYJ', 'BUF', '2026-11-15T18:00Z'::timestamptz),
(10, 'LV', 'SEA', '2026-11-15T21:05Z'::timestamptz),
(10, 'ARI', 'LAR', '2026-11-15T21:05Z'::timestamptz),
(10, 'DAL', 'SF', '2026-11-15T21:25Z'::timestamptz),
(10, 'CIN', 'PIT', '2026-11-16T01:20Z'::timestamptz),
(10, 'BAL', 'LAC', '2026-11-17T01:15Z'::timestamptz),
(11, 'HOU', 'IND', '2026-11-20T01:15Z'::timestamptz),
(11, 'BUF', 'MIA', '2026-11-22T18:00Z'::timestamptz),
(11, 'CHI', 'NO', '2026-11-22T18:00Z'::timestamptz),
(11, 'DAL', 'TEN', '2026-11-22T18:00Z'::timestamptz),
(11, 'DET', 'TB', '2026-11-22T18:00Z'::timestamptz),
(11, 'KC', 'ARI', '2026-11-22T18:00Z'::timestamptz),
(11, 'NYG', 'JAX', '2026-11-22T18:00Z'::timestamptz),
(11, 'CAR', 'BAL', '2026-11-22T18:00Z'::timestamptz),
(11, 'LAC', 'NYJ', '2026-11-22T21:05Z'::timestamptz),
(11, 'DEN', 'LV', '2026-11-22T21:25Z'::timestamptz),
(11, 'PHI', 'PIT', '2026-11-22T21:25Z'::timestamptz),
(11, 'SF', 'MIN', '2026-11-23T01:20Z'::timestamptz),
(11, 'WSH', 'CIN', '2026-11-24T01:15Z'::timestamptz),
(12, 'LAR', 'GB', '2026-11-26T01:00Z'::timestamptz),
(12, 'DET', 'CHI', '2026-11-26T18:00Z'::timestamptz),
(12, 'DAL', 'PHI', '2026-11-26T21:30Z'::timestamptz),
(12, 'BUF', 'KC', '2026-11-27T01:20Z'::timestamptz),
(12, 'PIT', 'DEN', '2026-11-27T20:00Z'::timestamptz),
(12, 'CIN', 'NO', '2026-11-29T18:00Z'::timestamptz),
(12, 'CLE', 'LV', '2026-11-29T18:00Z'::timestamptz),
(12, 'IND', 'NYG', '2026-11-29T18:00Z'::timestamptz),
(12, 'MIA', 'NYJ', '2026-11-29T18:00Z'::timestamptz),
(12, 'MIN', 'ATL', '2026-11-29T18:00Z'::timestamptz),
(12, 'HOU', 'BAL', '2026-11-29T18:00Z'::timestamptz),
(12, 'JAX', 'TEN', '2026-11-29T21:05Z'::timestamptz),
(12, 'ARI', 'WSH', '2026-11-29T21:25Z'::timestamptz),
(12, 'SF', 'SEA', '2026-11-29T21:25Z'::timestamptz),
(12, 'LAC', 'NE', '2026-11-30T01:20Z'::timestamptz),
(12, 'TB', 'CAR', '2026-12-01T01:15Z'::timestamptz),
(13, 'LAR', 'KC', '2026-12-04T01:15Z'::timestamptz),
(13, 'ATL', 'DET', '2026-12-06T18:00Z'::timestamptz),
(13, 'CHI', 'JAX', '2026-12-06T18:00Z'::timestamptz),
(13, 'CLE', 'CIN', '2026-12-06T18:00Z'::timestamptz),
(13, 'TEN', 'WSH', '2026-12-06T18:00Z'::timestamptz),
(13, 'NO', 'GB', '2026-12-06T18:00Z'::timestamptz),
(13, 'NYG', 'SF', '2026-12-06T18:00Z'::timestamptz),
(13, 'TB', 'LAC', '2026-12-06T18:00Z'::timestamptz),
(13, 'DEN', 'MIA', '2026-12-06T21:05Z'::timestamptz),
(13, 'ARI', 'PHI', '2026-12-06T21:05Z'::timestamptz),
(13, 'MIN', 'CAR', '2026-12-06T21:25Z'::timestamptz),
(13, 'NE', 'BUF', '2026-12-06T21:25Z'::timestamptz),
(13, 'PIT', 'HOU', '2026-12-07T01:20Z'::timestamptz),
(13, 'SEA', 'DAL', '2026-12-08T01:15Z'::timestamptz),
(14, 'NE', 'MIN', '2026-12-11T01:15Z'::timestamptz),
(14, 'CLE', 'ATL', '2026-12-13T18:00Z'::timestamptz),
(14, 'DET', 'TEN', '2026-12-13T18:00Z'::timestamptz),
(14, 'MIA', 'CHI', '2026-12-13T18:00Z'::timestamptz),
(14, 'NYJ', 'DEN', '2026-12-13T18:00Z'::timestamptz),
(14, 'PHI', 'IND', '2026-12-13T18:00Z'::timestamptz),
(14, 'WSH', 'HOU', '2026-12-13T18:00Z'::timestamptz),
(14, 'CAR', 'NO', '2026-12-13T18:00Z'::timestamptz),
(14, 'BAL', 'TB', '2026-12-13T18:00Z'::timestamptz),
(14, 'LV', 'LAC', '2026-12-13T21:05Z'::timestamptz),
(14, 'CIN', 'KC', '2026-12-13T21:25Z'::timestamptz),
(14, 'SF', 'LAR', '2026-12-13T21:25Z'::timestamptz),
(14, 'SEA', 'NYG', '2026-12-13T21:25Z'::timestamptz),
(14, 'GB', 'BUF', '2026-12-14T01:20Z'::timestamptz),
(14, 'JAX', 'PIT', '2026-12-15T01:15Z'::timestamptz),
(15, 'LAC', 'SF', '2026-12-18T01:15Z'::timestamptz),
(15, 'PHI', 'SEA', '2026-12-19T22:00Z'::timestamptz),
(15, 'BUF', 'CHI', '2026-12-20T01:20Z'::timestamptz),
(15, 'GB', 'MIA', '2026-12-20T18:00Z'::timestamptz),
(15, 'TEN', 'IND', '2026-12-20T18:00Z'::timestamptz),
(15, 'NYG', 'CLE', '2026-12-20T18:00Z'::timestamptz),
(15, 'PIT', 'BAL', '2026-12-20T18:00Z'::timestamptz),
(15, 'TB', 'NO', '2026-12-20T18:00Z'::timestamptz),
(15, 'WSH', 'ATL', '2026-12-20T18:00Z'::timestamptz),
(15, 'CAR', 'CIN', '2026-12-20T18:00Z'::timestamptz),
(15, 'HOU', 'JAX', '2026-12-20T18:00Z'::timestamptz),
(15, 'ARI', 'NYJ', '2026-12-20T21:05Z'::timestamptz),
(15, 'LV', 'DEN', '2026-12-20T21:25Z'::timestamptz),
(15, 'LAR', 'DAL', '2026-12-20T21:25Z'::timestamptz),
(15, 'MIN', 'DET', '2026-12-21T01:20Z'::timestamptz),
(15, 'KC', 'NE', '2026-12-22T01:15Z'::timestamptz),
(16, 'PHI', 'HOU', '2026-12-25T01:15Z'::timestamptz),
(16, 'CHI', 'GB', '2026-12-25T18:00Z'::timestamptz),
(16, 'DEN', 'BUF', '2026-12-25T21:30Z'::timestamptz),
(16, 'SEA', 'LAR', '2026-12-26T01:15Z'::timestamptz),
(16, 'ATL', 'TB', '2026-12-27T05:00Z'::timestamptz),
(16, 'IND', 'CIN', '2026-12-27T05:00Z'::timestamptz),
(16, 'MIN', 'WSH', '2026-12-27T05:00Z'::timestamptz),
(16, 'PIT', 'CAR', '2026-12-27T05:00Z'::timestamptz),
(16, 'MIA', 'LAC', '2026-12-27T18:00Z'::timestamptz),
(16, 'NO', 'ARI', '2026-12-27T18:00Z'::timestamptz),
(16, 'NYJ', 'NE', '2026-12-27T18:00Z'::timestamptz),
(16, 'BAL', 'CLE', '2026-12-27T18:00Z'::timestamptz),
(16, 'LV', 'TEN', '2026-12-27T21:05Z'::timestamptz),
(16, 'KC', 'SF', '2026-12-27T21:25Z'::timestamptz),
(16, 'DAL', 'JAX', '2026-12-28T01:20Z'::timestamptz),
(16, 'DET', 'NYG', '2026-12-29T01:15Z'::timestamptz),
(17, 'CIN', 'BAL', '2027-01-01T01:15Z'::timestamptz),
(17, 'NE', 'DEN', '2027-01-03T05:00Z'::timestamptz),
(17, 'LAC', 'KC', '2027-01-03T05:00Z'::timestamptz),
(17, 'TB', 'LAR', '2027-01-03T05:00Z'::timestamptz),
(17, 'JAX', 'WSH', '2027-01-03T05:00Z'::timestamptz),
(17, 'ATL', 'NO', '2027-01-03T18:00Z'::timestamptz),
(17, 'CLE', 'IND', '2027-01-03T18:00Z'::timestamptz),
(17, 'DAL', 'NYG', '2027-01-03T18:00Z'::timestamptz),
(17, 'TEN', 'PIT', '2027-01-03T18:00Z'::timestamptz),
(17, 'MIA', 'BUF', '2027-01-03T18:00Z'::timestamptz),
(17, 'NYJ', 'MIN', '2027-01-03T18:00Z'::timestamptz),
(17, 'CAR', 'SEA', '2027-01-03T18:00Z'::timestamptz),
(17, 'ARI', 'LV', '2027-01-03T21:05Z'::timestamptz),
(17, 'CHI', 'DET', '2027-01-03T21:25Z'::timestamptz),
(17, 'SF', 'PHI', '2027-01-04T01:20Z'::timestamptz),
(17, 'GB', 'HOU', '2027-01-05T01:15Z'::timestamptz),
-- Week 18 times are not yet finalized by the NFL as of this writing
-- (flex-scheduled in the final week of the season); placeholder kickoff
-- times below all fall on Jan 10, 2027 — update them once the league
-- announces real times (see the UPDATE example at the bottom of this file).
(18, 'BUF', 'NYJ', '2027-01-10T18:00Z'::timestamptz),
(18, 'CIN', 'CLE', '2027-01-10T18:00Z'::timestamptz),
(18, 'DEN', 'LAC', '2027-01-10T18:00Z'::timestamptz),
(18, 'GB', 'DET', '2027-01-10T18:00Z'::timestamptz),
(18, 'IND', 'JAX', '2027-01-10T18:00Z'::timestamptz),
(18, 'KC', 'LV', '2027-01-10T18:00Z'::timestamptz),
(18, 'LAR', 'SEA', '2027-01-10T18:00Z'::timestamptz),
(18, 'MIN', 'CHI', '2027-01-10T18:00Z'::timestamptz),
(18, 'NE', 'MIA', '2027-01-10T18:00Z'::timestamptz),
(18, 'NO', 'TB', '2027-01-10T18:00Z'::timestamptz),
(18, 'NYG', 'PHI', '2027-01-10T18:00Z'::timestamptz),
(18, 'ARI', 'SF', '2027-01-10T18:00Z'::timestamptz),
(18, 'WSH', 'DAL', '2027-01-10T18:00Z'::timestamptz),
(18, 'CAR', 'ATL', '2027-01-10T18:00Z'::timestamptz),
(18, 'BAL', 'PIT', '2027-01-10T18:00Z'::timestamptz),
(18, 'HOU', 'TEN', '2027-01-10T18:00Z'::timestamptz);

-- Example for updating a game's kickoff time later (e.g. once Week 18
-- times are announced, or a game gets flexed to a different slot):
--   update games set kickoff = '2027-01-10T21:25Z'::timestamptz
--   where week = 18 and home = 'KC' and away = 'LV';

create table if not exists teams (
  code text primary key,
  name text not null
);

insert into teams (code, name) values
  ('ARI','Arizona Cardinals'), ('ATL','Atlanta Falcons'), ('BAL','Baltimore Ravens'),
  ('BUF','Buffalo Bills'), ('CAR','Carolina Panthers'), ('CHI','Chicago Bears'),
  ('CIN','Cincinnati Bengals'), ('CLE','Cleveland Browns'), ('DAL','Dallas Cowboys'),
  ('DEN','Denver Broncos'), ('DET','Detroit Lions'), ('GB','Green Bay Packers'),
  ('HOU','Houston Texans'), ('IND','Indianapolis Colts'), ('JAX','Jacksonville Jaguars'),
  ('KC','Kansas City Chiefs'), ('LAC','Los Angeles Chargers'), ('LAR','Los Angeles Rams'),
  ('LV','Las Vegas Raiders'), ('MIA','Miami Dolphins'), ('MIN','Minnesota Vikings'),
  ('NE','New England Patriots'), ('NO','New Orleans Saints'), ('NYG','New York Giants'),
  ('NYJ','New York Jets'), ('PHI','Philadelphia Eagles'), ('PIT','Pittsburgh Steelers'),
  ('SEA','Seattle Seahawks'), ('SF','San Francisco 49ers'), ('TB','Tampa Bay Buccaneers'),
  ('TEN','Tennessee Titans'), ('WSH','Washington Commanders')
on conflict (code) do nothing;

-- ── Core pool tables ────────────────────────────────────────────────

create table if not exists players (
  id bigserial primary key,
  slug text unique not null,
  name text not null,
  pin_hash text not null,
  rebought boolean not null default false,
  rebuy_week int,
  paid boolean not null default false,
  created_at timestamptz not null default now()
);

alter table players add column if not exists paid boolean not null default false;

create table if not exists picks (
  id bigserial primary key,
  player_id bigint not null references players(id) on delete cascade,
  week int not null,
  team text not null,
  locked_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  unique (player_id, week)
);

create table if not exists results (
  id bigserial primary key,
  week int not null,
  home text not null,
  away text not null,
  winner text, -- team code, or 'TIE', or null = undecided
  decided_at timestamptz,
  unique (week, home, away)
);

create table if not exists admin_config (
  id int primary key default 1,
  passphrase_hash text not null,
  check (id = 1)
);

-- ── Row Level Security ──────────────────────────────────────────────

alter table games enable row level security;
alter table teams enable row level security;
alter table players enable row level security;
alter table picks enable row level security;
alter table results enable row level security;
alter table admin_config enable row level security;

-- RLS policies control which ROWS are visible; PostgREST also requires
-- the base table-level GRANT below regardless of policies (Supabase's
-- Table Editor sets this up for you automatically, but tables created
-- via the SQL Editor, like these, do not get it by default).

drop policy if exists games_read on games;
create policy games_read on games for select using (true);
grant select on games to anon, authenticated;

drop policy if exists teams_read on teams;
create policy teams_read on teams for select using (true);
grant select on teams to anon, authenticated;

drop policy if exists players_read on players;
create policy players_read on players for select using (true);
-- pin_hash is never exposed: grant column-level select excluding it.
revoke select on players from anon, authenticated;
grant select (id, slug, name, rebought, rebuy_week, paid, created_at) on players to anon, authenticated;

drop policy if exists picks_read_locked on picks;
create policy picks_read_locked on picks for select using (locked_at <= now());
grant select on picks to anon, authenticated;
-- No insert/update/delete policies for anon — all writes go through the
-- SECURITY DEFINER functions below.

drop policy if exists results_read on results;
create policy results_read on results for select using (true);
grant select on results to anon, authenticated;

-- admin_config: no policies at all — completely inaccessible except to
-- SECURITY DEFINER functions (which run as the table owner and bypass RLS).

-- ── Helper functions ────────────────────────────────────────────────

create or replace function week_deadline(p_week int)
returns timestamptz
language sql
stable
as $$
  -- The Sunday 1:00 PM ET deadline for a given week, derived from the
  -- real schedule: find the Sunday among that week's games and anchor
  -- 1:00 PM Eastern to that calendar date.
  select (date_trunc('day', g.kickoff at time zone 'America/New_York')
            + interval '13 hours') at time zone 'America/New_York'
  from games g
  where g.week = p_week
    and extract(dow from g.kickoff at time zone 'America/New_York') = 0
  order by g.kickoff
  limit 1;
$$;

create or replace function pick_lock_time(p_week int, p_team text)
returns timestamptz
language sql
stable
as $$
  -- The earlier of: the picked team's own kickoff, or the week's Sunday
  -- 1pm ET deadline. Matches the stated rule ("Thursday night picks lock
  -- at kickoff, everything else locks Sunday 1pm ET") and generalizes to
  -- any early game (Wed/Thu/Fri), not just Thursday specifically.
  select least(
    (select g.kickoff from games g
      where g.week = p_week and (g.home = p_team or g.away = p_team)
      limit 1),
    week_deadline(p_week)
  );
$$;

-- ── RPC: player registration / login ────────────────────────────────

create or replace function register_or_login(p_name text, p_pin text)
returns table(player_id bigint, out_name text, is_new boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_slug text := lower(regexp_replace(trim(p_name), '\s+', ' ', 'g'));
  v_row players%rowtype;
begin
  if v_slug = '' then
    raise exception 'invalid_name';
  end if;
  if p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'invalid_pin';
  end if;

  select * into v_row from players where slug = v_slug;

  if found then
    if v_row.pin_hash <> extensions.crypt(p_pin, v_row.pin_hash) then
      raise exception 'wrong_pin';
    end if;
    return query select v_row.id, v_row.name, false;
  else
    insert into players (slug, name, pin_hash)
    values (v_slug, trim(p_name), extensions.crypt(p_pin, extensions.gen_salt('bf')))
    returning players.id, players.name, true into player_id, out_name, is_new;
    return next;
  end if;
end;
$$;

-- ── RPC: submit or change a pick ─────────────────────────────────────

create or replace function submit_pick(p_player_id bigint, p_pin text, p_week int, p_team text)
returns table(locked_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pin_hash text;
  v_lock timestamptz;
  v_existing picks%rowtype;
  v_dupe_week int;
begin
  select pin_hash into v_pin_hash from players where id = p_player_id;
  if v_pin_hash is null or v_pin_hash <> extensions.crypt(p_pin, v_pin_hash) then
    raise exception 'wrong_pin';
  end if;

  if not exists (select 1 from games where week = p_week and (home = p_team or away = p_team)) then
    raise exception 'team_not_playing_this_week';
  end if;

  v_lock := pick_lock_time(p_week, p_team);
  if v_lock is null then
    raise exception 'schedule_error';
  end if;
  if v_lock <= now() then
    raise exception 'past_deadline';
  end if;

  select * into v_existing from picks where player_id = p_player_id and week = p_week;
  if found and v_existing.locked_at <= now() then
    raise exception 'week_already_locked';
  end if;

  select week into v_dupe_week from picks
    where player_id = p_player_id and team = p_team and week <> p_week
    limit 1;
  if found then
    raise exception 'team_already_used_week_%', v_dupe_week;
  end if;

  insert into picks (player_id, week, team, locked_at)
  values (p_player_id, p_week, p_team, v_lock)
  on conflict (player_id, week)
  do update set team = excluded.team, locked_at = excluded.locked_at, submitted_at = now();

  return query select v_lock;
end;
$$;

-- ── RPC: read your own picks (including still-locked ones) ──────────

create or replace function get_my_picks(p_player_id bigint, p_pin text)
returns setof picks
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pin_hash text;
begin
  select pin_hash into v_pin_hash from players where id = p_player_id;
  if v_pin_hash is null or v_pin_hash <> extensions.crypt(p_pin, v_pin_hash) then
    raise exception 'wrong_pin';
  end if;

  return query select * from picks where player_id = p_player_id order by week;
end;
$$;

-- ── RPC: admin — record a game result ────────────────────────────────

create or replace function admin_set_result(p_passphrase text, p_week int, p_home text, p_away text, p_winner text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select passphrase_hash into v_hash from admin_config where id = 1;
  if v_hash is null or v_hash <> extensions.crypt(p_passphrase, v_hash) then
    raise exception 'wrong_passphrase';
  end if;
  if p_winner is not null and p_winner not in (p_home, p_away, 'TIE') then
    raise exception 'invalid_winner';
  end if;

  insert into results (week, home, away, winner, decided_at)
  values (p_week, p_home, p_away, p_winner, case when p_winner is null then null else now() end)
  on conflict (week, home, away)
  do update set winner = excluded.winner, decided_at = excluded.decided_at;
end;
$$;

-- ── RPC: admin — mark a player as rebought (buyback) ─────────────────

create or replace function admin_set_rebuy(p_passphrase text, p_player_id bigint, p_rebought boolean, p_rebuy_week int)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select passphrase_hash into v_hash from admin_config where id = 1;
  if v_hash is null or v_hash <> extensions.crypt(p_passphrase, v_hash) then
    raise exception 'wrong_passphrase';
  end if;

  update players set rebought = p_rebought, rebuy_week = p_rebuy_week where id = p_player_id;
end;
$$;

-- ── RPC: admin — mark a player as paid ────────────────────────────────

create or replace function admin_set_paid(p_passphrase text, p_player_id bigint, p_paid boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select passphrase_hash into v_hash from admin_config where id = 1;
  if v_hash is null or v_hash <> extensions.crypt(p_passphrase, v_hash) then
    raise exception 'wrong_passphrase';
  end if;

  update players set paid = p_paid where id = p_player_id;
end;
$$;

-- ── RPC: admin — reset a forgotten PIN ────────────────────────────────

create or replace function admin_reset_pin(p_passphrase text, p_player_id bigint, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select passphrase_hash into v_hash from admin_config where id = 1;
  if v_hash is null or v_hash <> extensions.crypt(p_passphrase, v_hash) then
    raise exception 'wrong_passphrase';
  end if;
  if p_new_pin !~ '^[0-9]{4,8}$' then
    raise exception 'invalid_pin';
  end if;

  update players set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')) where id = p_player_id;
end;
$$;

-- ── Seed: commissioner passphrase ────────────────────────────────────
-- Replace 'CHANGE_ME_ADMIN_PASSPHRASE' below with your own passphrase
-- before running this script. This is the only place the plaintext
-- passphrase appears, and only in the SQL editor / your local copy of
-- this file — never commit your real value to git.

insert into admin_config (id, passphrase_hash)
values (1, extensions.crypt('CHANGE_ME_ADMIN_PASSPHRASE', extensions.gen_salt('bf')))
on conflict (id) do nothing;

-- To change the passphrase later, run:
--   update admin_config set passphrase_hash = extensions.crypt('new passphrase', extensions.gen_salt('bf')) where id = 1;

grant execute on function register_or_login(text, text) to anon, authenticated;
grant execute on function submit_pick(bigint, text, int, text) to anon, authenticated;
grant execute on function get_my_picks(bigint, text) to anon, authenticated;
grant execute on function admin_set_result(text, int, text, text, text) to anon, authenticated;
grant execute on function admin_set_rebuy(text, bigint, boolean, int) to anon, authenticated;
grant execute on function admin_set_paid(text, bigint, boolean) to anon, authenticated;
grant execute on function admin_reset_pin(text, bigint, text) to anon, authenticated;
