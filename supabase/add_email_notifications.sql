-- One-time patch: adds email collection + the scheduled reminder/recap
-- email jobs to an already-running project. Safe to run any number of
-- times. (New projects don't need this — it's now part of schema.sql
-- itself.)

alter table players add column if not exists email text;
-- email is intentionally NOT added to the players select grant below —
-- it stays private, exposed only through admin_list_players (passphrase-
-- gated), never in the public players/public_picks reads.

create table if not exists email_log (
  kind text not null,
  week int not null,
  sent_at timestamptz not null default now(),
  primary key (kind, week)
);

alter table email_log enable row level security;
-- No policies at all — completely inaccessible except to SECURITY DEFINER
-- functions (same pattern as admin_config).

create or replace function current_week()
returns int
language sql
stable
as $$
  select coalesce(
    (select min(week) from games where week_deadline(week) > now()),
    (select max(week) from games)
  );
$$;

create or replace function last_closed_week()
returns int
language sql
stable
as $$
  select max(week) from games where week_deadline(week) <= now();
$$;

-- p_email is optional and never required: passing it (on registration or
-- any later login) sets/updates that player's email address, used only for
-- the missed-pick reminder and weekly recap emails — never shown publicly
-- (see the players grant below, which excludes the email column).
drop function if exists register_or_login(text, text);

create or replace function register_or_login(p_name text, p_pin text, p_email text default null)
returns table(player_id bigint, out_name text, is_new boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_slug text := lower(regexp_replace(trim(p_name), '\s+', ' ', 'g'));
  v_row players%rowtype;
  v_email text := nullif(trim(p_email), '');
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
    if v_email is not null then
      update players set email = v_email where id = v_row.id;
    end if;
    return query select v_row.id, v_row.name, false;
  else
    insert into players (slug, name, pin_hash, email)
    values (v_slug, trim(p_name), extensions.crypt(p_pin, extensions.gen_salt('bf')), v_email)
    returning players.id, players.name, true into player_id, out_name, is_new;
    return next;
  end if;
end;
$$;

create or replace function admin_list_players(p_passphrase text)
returns table(id bigint, name text, email text, slug text, rebought boolean, rebuy_week int, paid boolean)
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
    select p.id, p.name, p.email, p.slug, p.rebought, p.rebuy_week, p.paid
    from players p
    order by p.name;
end;
$$;

create or replace function admin_claim_email_send(p_passphrase text, p_kind text, p_week int)
returns boolean
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

  insert into email_log (kind, week) values (p_kind, p_week)
  on conflict (kind, week) do nothing;
  return found;
end;
$$;

grant execute on function register_or_login(text, text, text) to anon, authenticated;
grant execute on function admin_list_players(text) to anon, authenticated;
grant execute on function admin_claim_email_send(text, text, int) to anon, authenticated;
grant execute on function current_week() to anon, authenticated;
grant execute on function last_closed_week() to anon, authenticated;
grant execute on function week_deadline(int) to anon, authenticated;
