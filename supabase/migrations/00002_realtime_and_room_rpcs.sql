-- =============================================================================
-- 00002_realtime_and_room_rpcs.sql
-- Phase 4 support: make the room-scoped tables work with Supabase Realtime and
-- add atomic room create/join RPCs.
--
-- WHY THE READ POLICIES CHANGE
-- ----------------------------
-- Realtime "Postgres Changes" evaluates a subscriber's RLS using only the
-- websocket connection's role/JWT. Our identity lives in the `x-user-token`
-- HTTP header, which is a PostgREST concept and is NOT available during the
-- Realtime RLS check. The Phase 1 member-scoped SELECT policies
-- (app_is_room_member, which reads that header) therefore always evaluated to
-- FALSE over the websocket, so NO change events were ever delivered.
--
-- Fix: allow public SELECT on the realtime tables so events flow. The `token`
-- credential column is simultaneously locked down with column-level privileges
-- so it can never be read back (over HTTP or Realtime) even though rows are
-- now publicly selectable. All write policies remain header-gated.
--
-- TRADE-OFF: a holder of the public anon key who also knows a room's id/code
-- can read that room's members/bills/debts. For a casual code-to-join expense
-- app this matches the existing "rooms are joinable by code" exposure. To
-- restore member-scoped reads later, adopt Supabase Anonymous Auth (real JWTs)
-- + supabase.realtime.setAuth(); the SELECT policies can then key off
-- auth.uid() and will also be honored by Realtime.
-- =============================================================================

-- ---- Public read policies (replace the member-scoped ones) ----------------
drop policy if exists users_select_members on users;
create policy users_select_public on users for select using (true);

drop policy if exists bills_select_members on bills;
create policy bills_select_public on bills for select using (true);

drop policy if exists debts_select_members on debts;
create policy debts_select_public on debts for select using (true);

drop policy if exists action_logs_select_members on action_logs;
create policy action_logs_select_public on action_logs for select using (true);

-- ---- Hide the credential column ------------------------------------------
-- Rows are now publicly readable, but `users.token` is the bearer credential
-- and must never be exposed. Column-level privileges restrict SELECT to the
-- safe columns; Realtime honors these too, so token never appears in payloads.
revoke select on users from anon, authenticated;
grant select (id, room_id, nickname, is_host, created_at)
  on users to anon, authenticated;

-- =============================================================================
-- RPC: create_room
-- Atomically creates the room, the host `users` row, and links host_user_id.
-- SECURITY DEFINER so the multi-step write runs as one trusted unit; the host's
-- identity is taken from the x-user-token header, never trusted from the body.
-- The 6-char room_code is generated client-side and passed in; a unique
-- violation propagates so the client can retry with a fresh code.
-- =============================================================================
create or replace function create_room(
  p_room_code     text,
  p_base_currency text,
  p_nickname      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token  uuid := app_current_token();
  v_room   rooms;
  v_member users;
begin
  if v_token is null then
    raise exception 'MISSING_USER_TOKEN';
  end if;
  if coalesce(btrim(p_nickname), '') = '' then
    raise exception 'NICKNAME_REQUIRED';
  end if;

  insert into rooms (room_code, base_currency)
  values (upper(p_room_code), coalesce(nullif(btrim(p_base_currency), ''), 'TWD'))
  returning * into v_room;

  insert into users (room_id, token, nickname, is_host)
  values (v_room.id, v_token, btrim(p_nickname), true)
  returning * into v_member;

  update rooms set host_user_id = v_member.id where id = v_room.id
  returning * into v_room;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'member', jsonb_build_object(
      'id', v_member.id, 'room_id', v_member.room_id,
      'nickname', v_member.nickname, 'is_host', v_member.is_host,
      'created_at', v_member.created_at
    )
  );
end;
$$;

-- =============================================================================
-- RPC: join_room
-- Looks the room up by code and upserts the caller's membership. The upsert on
-- (room_id, token) is what implements "reconnect = re-claim identity": a
-- returning device with the same token re-attaches to its existing row (and may
-- refresh its nickname) instead of creating a duplicate.
-- =============================================================================
create or replace function join_room(
  p_room_code text,
  p_nickname  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token  uuid := app_current_token();
  v_room   rooms;
  v_member users;
begin
  if v_token is null then
    raise exception 'MISSING_USER_TOKEN';
  end if;
  if coalesce(btrim(p_nickname), '') = '' then
    raise exception 'NICKNAME_REQUIRED';
  end if;

  select * into v_room from rooms where room_code = upper(btrim(p_room_code));
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'active' then
    raise exception 'ROOM_CLOSED';
  end if;

  insert into users (room_id, token, nickname, is_host)
  values (v_room.id, v_token, btrim(p_nickname), false)
  on conflict (room_id, token)
    do update set nickname = excluded.nickname
  returning * into v_member;

  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'member', jsonb_build_object(
      'id', v_member.id, 'room_id', v_member.room_id,
      'nickname', v_member.nickname, 'is_host', v_member.is_host,
      'created_at', v_member.created_at
    )
  );
end;
$$;

grant execute on function create_room(text, text, text) to anon, authenticated;
grant execute on function join_room(text, text)         to anon, authenticated;
