-- One-time patch: adds the DST-safe per-week target-time functions the
-- 4-email schedule (Friday all-reminder, Sunday non-picker reminder, pick
-- summary, weekly results) uses to decide when to fire. Safe to run any
-- number of times. (New projects don't need this — it's now part of
-- schema.sql itself.) Requires add_email_notifications.sql to already be
-- applied (uses week_deadline(), current_week(), etc.).

-- Each of these computes a specific America/New_York wall-clock moment
-- relative to a week's Sunday, the same DST-safe way as week_deadline():
-- resolve the calendar DATE first, then convert (date + local time) to a
-- UTC instant via "at time zone", rather than adding a raw interval to an
-- existing timestamptz (which can drift an hour across a DST boundary).
-- The email scripts poll hourly and compare now() >= target, so exact
-- cron timing doesn't matter — only these functions need to be correct.

create or replace function week_sunday_date(p_week int)
returns date
language sql
stable
as $$
  select (week_deadline(p_week) at time zone 'America/New_York')::date;
$$;

-- Email #1 (remind everyone to pick): Friday 1:00 PM ET, two days before
-- that week's Sunday.
create or replace function friday_reminder_time(p_week int)
returns timestamptz
language sql
stable
as $$
  select ((week_sunday_date(p_week) - 2) + time '13:00') at time zone 'America/New_York';
$$;

-- Email #2 (remind only non-pickers): Sunday 10:00 AM ET, same week.
create or replace function sunday_reminder_time(p_week int)
returns timestamptz
language sql
stable
as $$
  select (week_sunday_date(p_week) + time '10:00') at time zone 'America/New_York';
$$;

-- Email #3 (pick summary chart + table): Sunday 1:30 PM ET, 30 minutes
-- after the picking deadline.
create or replace function pick_summary_time(p_week int)
returns timestamptz
language sql
stable
as $$
  select (week_sunday_date(p_week) + time '13:30') at time zone 'America/New_York';
$$;

grant execute on function week_sunday_date(int) to anon, authenticated;
grant execute on function friday_reminder_time(int) to anon, authenticated;
grant execute on function sunday_reminder_time(int) to anon, authenticated;
grant execute on function pick_summary_time(int) to anon, authenticated;
