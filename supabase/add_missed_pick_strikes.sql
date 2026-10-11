-- One-time patch: adds the missed-pick-counts-as-a-strike rule as a single
-- server-side source of truth. Safe to run any number of times. (New
-- projects don't need this — it's now part of schema.sql itself.)

-- A missed pick counts as a strike, same as picking the team that went on
-- to win — a week only counts once its deadline has passed (picking is
-- still open), once a player has actually joined (never blames someone
-- for a week before they registered), and, for a rebought player, only
-- from their rebuy week onward (pre-rebuy weeks are wiped clean, missed
-- picks included). Computed here once, server-side, rather than
-- duplicated across the site's JS and the email scripts, so standings,
-- history, and every email always agree.
create or replace function all_player_strikes()
returns table(player_id bigint, strikes int, eliminated boolean)
language sql
stable
as $$
  with closed_weeks as (
    select distinct g.week from games g where week_deadline(g.week) <= now()
  ),
  applicable as (
    select p.id as player_id, cw.week
    from players p
    cross join closed_weeks cw
    where cw.week >= case when p.rebought then coalesce(p.rebuy_week, 1) else 1 end
      and p.created_at <= week_deadline(cw.week)
  ),
  per_week as (
    select a.player_id, a.week, pk.team, r.winner
    from applicable a
    left join picks pk on pk.player_id = a.player_id and pk.week = a.week
    left join results r on r.week = a.week and (r.home = pk.team or r.away = pk.team)
  ),
  strike_counts as (
    select player_id,
      count(*) filter (
        where team is null
           or (winner is not null and winner <> 'TIE' and winner = team)
      ) as strikes
    from per_week
    group by player_id
  )
  select p.id,
    -- Cap the displayed count at the elimination threshold: once a player
    -- is out and never buys back in, further missed weeks shouldn't keep
    -- inflating their strike count (2, 3, 4...) — it just stays "2/2" (or
    -- "1/1" post-rebuy). The eliminated flag below is unaffected either
    -- way, since it's derived from the uncapped total.
    least(coalesce(sc.strikes, 0), case when p.rebought then 1 else 2 end) as strikes,
    coalesce(sc.strikes, 0) >= (case when p.rebought then 1 else 2 end) as eliminated
  from players p
  left join strike_counts sc on sc.player_id = p.id;
$$;

grant execute on function all_player_strikes() to anon, authenticated;

-- created_at is included so the email scripts can apply the same "did
-- this player even exist yet" rule as all_player_strikes() when deciding
-- whether a missing pick counts.
drop function if exists admin_list_players(text);

create or replace function admin_list_players(p_passphrase text)
returns table(id bigint, name text, email text, slug text, rebought boolean, rebuy_week int, paid boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  -- admin_config.id must be qualified here: this function's own OUT
  -- parameter list (RETURNS TABLE(id bigint, ...)) declares a PL/pgSQL
  -- variable named "id" that shadows the bare column reference otherwise.
  select passphrase_hash into v_hash from admin_config where admin_config.id = 1;
  if v_hash is null or v_hash <> extensions.crypt(p_passphrase, v_hash) then
    raise exception 'wrong_passphrase';
  end if;

  return query
    select p.id, p.name, p.email, p.slug, p.rebought, p.rebuy_week, p.paid, p.created_at
    from players p
    order by p.name;
end;
$$;

grant execute on function admin_list_players(text) to anon, authenticated;
