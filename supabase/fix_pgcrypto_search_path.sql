-- One-time patch for projects that already ran an older version of
-- schema.sql before it fixed the pgcrypto references. On this Supabase
-- project, pgcrypto (crypt/gen_salt) lives in the "extensions" schema
-- rather than "public", so the SECURITY DEFINER functions below (which
-- pin search_path for safety) couldn't see crypt()/gen_salt() and every
-- login/pick/admin call failed with "function crypt(...) does not
-- exist". This re-creates them fully schema-qualified as
-- extensions.crypt()/extensions.gen_salt() (not just relying on
-- search_path, which is easy to accidentally undo). Safe to run any
-- number of times.
-- (New projects don't need this — it's now part of schema.sql itself.)

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
