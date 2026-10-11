-- One-time patch: adds per-week strike detail behind all_player_strikes(),
-- so the standings grid and history page can mark only the weeks that
-- actually counted toward elimination, instead of flagging every
-- strike-shaped week forever once someone's eliminated and never buys
-- back in. Safe to run any number of times. (New projects don't need
-- this — it's now part of schema.sql itself. Requires
-- add_missed_pick_strikes.sql to already be applied.)

create or replace function player_week_strikes()
returns table(player_id bigint, week int, is_strike boolean, counted boolean)
language sql
stable
as $$
  with closed_weeks as (
    select distinct g.week from games g where week_deadline(g.week) <= now()
  ),
  applicable as (
    select p.id as player_id, p.rebought, cw.week
    from players p
    cross join closed_weeks cw
    where cw.week >= case when p.rebought then coalesce(p.rebuy_week, 1) else 1 end
      and p.created_at <= week_deadline(cw.week)
  ),
  per_week as (
    select a.player_id, a.rebought, a.week,
      (pk.team is null or (r.winner is not null and r.winner <> 'TIE' and r.winner = pk.team)) as is_strike
    from applicable a
    left join picks pk on pk.player_id = a.player_id and pk.week = a.week
    left join results r on r.week = a.week and (r.home = pk.team or r.away = pk.team)
  )
  select player_id, week, is_strike,
    is_strike and sum(case when is_strike then 1 else 0 end) over (
      partition by player_id order by week
      rows between unbounded preceding and current row
    ) <= (case when rebought then 1 else 2 end) as counted
  from per_week
  order by player_id, week;
$$;

grant execute on function player_week_strikes() to anon, authenticated;
