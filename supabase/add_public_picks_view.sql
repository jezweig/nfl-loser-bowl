-- One-time patch for the already-running project. Adds a view that lets
-- the standings page distinguish "submitted a pick, still locked" from
-- "hasn't picked at all" — the raw `picks` table's RLS policy hides the
-- whole row (not just the team) until locked_at passes, so today both
-- cases look identical (nothing). This view exposes that a row exists
-- for every submitted pick, but keeps masking WHICH team until it locks.
-- Safe to run any number of times. (New projects don't need this — it's
-- now part of schema.sql itself.)

drop view if exists public_picks;
create view public_picks as
select
  id,
  player_id,
  week,
  case when locked_at <= now() then team else null end as team,
  locked_at,
  submitted_at
from picks;

grant select on public_picks to anon, authenticated;
