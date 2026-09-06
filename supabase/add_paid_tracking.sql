-- One-time patch: adds "paid" tracking to an already-running project.
-- Safe to run any number of times. (New projects don't need this — it's
-- now part of schema.sql itself.)

alter table players add column if not exists paid boolean not null default false;

grant select (paid) on players to anon, authenticated;

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

grant execute on function admin_set_paid(text, bigint, boolean) to anon, authenticated;
