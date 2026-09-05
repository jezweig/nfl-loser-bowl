-- One-time patch for projects that already ran the original schema.sql
-- before it included these grants. Safe to run any number of times.
-- (New projects don't need this — it's now part of schema.sql itself.)

grant select on games to anon, authenticated;
grant select on teams to anon, authenticated;
grant select on picks to anon, authenticated;
grant select on results to anon, authenticated;
