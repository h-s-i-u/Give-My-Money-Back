-- =============================================================================
-- 00005_bill_edit_delete_and_dupes.sql
-- Bug fixes + new features:
--   1. Duplicate nickname prevention in join_room (case-insensitive).
--   2. Duplicate bill-name prevention in add_bill / update_bill (case-insensitive).
--   3. update_bill RPC (creator-only edit).
--   4. Two-party confirmation soft-delete: bills.status + delete_requested_by,
--      request_bill_delete / confirm_bill_delete RPCs.
-- =============================================================================

-- ---- Schema: soft-delete state machine on bills ---------------------------
alter table bills
  add column status text not null default 'active'
    check (status in ('active', 'pending_delete', 'deleted'));

alter table bills
  add column delete_requested_by uuid references users(id) on delete set null;

comment on column bills.status is
  'Soft-delete state machine: active -> pending_delete (one participant requested) -> deleted (another participant confirmed). deleted bills are ignored by settlement.';
comment on column bills.delete_requested_by is
  'Member who requested deletion; a DIFFERENT participant must confirm to reach deleted.';

create index idx_bills_room_status on bills (room_id, status);

-- =============================================================================
-- join_room: now rejects a nickname already taken in the room (case-insensitive),
-- ignoring the caller's own existing membership (so reconnect/reclaim still works).
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

  -- Strict duplicate-nickname guard. Excludes the caller's own row (token), so
  -- a returning device re-claiming its identity keeps its name.
  if exists (
    select 1 from users
    where room_id = v_room.id
      and lower(nickname) = lower(btrim(p_nickname))
      and token <> v_token
  ) then
    raise exception 'NICKNAME_TAKEN';
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

-- =============================================================================
-- add_bill: now rejects a duplicate (case-insensitive) title among the room's
-- non-deleted bills.
-- =============================================================================
create or replace function add_bill(
  p_room_id           uuid,
  p_title             text,
  p_note              text,
  p_original_currency text,
  p_original_amount   numeric,
  p_exchange_rate     numeric,
  p_base_amount       numeric,
  p_payer_user_id     uuid,
  p_split_among       uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token   uuid := app_current_token();
  v_creator users;
  v_bill    bills;
  v_pid     uuid;
  v_n       int;
begin
  if v_token is null then raise exception 'MISSING_USER_TOKEN'; end if;

  select * into v_creator from users where room_id = p_room_id and token = v_token;
  if not found then raise exception 'NOT_A_MEMBER'; end if;

  if coalesce(btrim(p_title), '') = '' then raise exception 'TITLE_REQUIRED'; end if;
  if p_original_amount <= 0 or p_base_amount <= 0 or p_exchange_rate <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- Duplicate bill-name guard (ignores soft-deleted bills, whose names free up).
  if exists (
    select 1 from bills
    where room_id = p_room_id
      and lower(title) = lower(btrim(p_title))
      and status <> 'deleted'
  ) then
    raise exception 'DUPLICATE_BILL_TITLE';
  end if;

  if not exists (select 1 from users where id = p_payer_user_id and room_id = p_room_id) then
    raise exception 'INVALID_PAYER';
  end if;

  v_n := array_length(p_split_among, 1);
  if v_n is null or v_n = 0 then raise exception 'NO_PARTICIPANTS'; end if;
  foreach v_pid in array p_split_among loop
    if not exists (select 1 from users where id = v_pid and room_id = p_room_id) then
      raise exception 'INVALID_PARTICIPANT';
    end if;
  end loop;

  insert into bills (
    room_id, creator_user_id, payer_user_id, title, note,
    original_currency, original_amount, exchange_rate, base_amount, split_among
  )
  values (
    p_room_id, v_creator.id, p_payer_user_id, btrim(p_title),
    nullif(btrim(coalesce(p_note, '')), ''),
    upper(p_original_currency), p_original_amount, p_exchange_rate, p_base_amount,
    p_split_among
  )
  returning * into v_bill;

  insert into action_logs (room_id, actor_user_id, action_type, message, metadata)
  values (
    p_room_id, v_creator.id, 'bill_created',
    format('%s added %s (%s %s)', v_creator.nickname, btrim(p_title),
           trim_scale(p_original_amount), upper(p_original_currency)),
    jsonb_build_object('bill_id', v_bill.id)
  );

  return to_jsonb(v_bill);
end;
$$;

-- =============================================================================
-- update_bill: creator-only edit, with the same duplicate-name guard (excluding
-- the bill being edited). Only 'active' bills may be edited.
-- =============================================================================
create or replace function update_bill(
  p_bill_id           uuid,
  p_title             text,
  p_note              text,
  p_original_currency text,
  p_original_amount   numeric,
  p_exchange_rate     numeric,
  p_base_amount       numeric,
  p_payer_user_id     uuid,
  p_split_among       uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token   uuid := app_current_token();
  v_bill    bills;
  v_creator users;
  v_pid     uuid;
  v_n       int;
begin
  if v_token is null then raise exception 'MISSING_USER_TOKEN'; end if;

  select * into v_bill from bills where id = p_bill_id;
  if not found then raise exception 'BILL_NOT_FOUND'; end if;

  -- Permission: only the original creator (matched by their token) may edit.
  select * into v_creator from users where id = v_bill.creator_user_id;
  if v_creator.token is distinct from v_token then raise exception 'NOT_BILL_CREATOR'; end if;
  if v_bill.status <> 'active' then raise exception 'BILL_NOT_EDITABLE'; end if;

  if coalesce(btrim(p_title), '') = '' then raise exception 'TITLE_REQUIRED'; end if;
  if p_original_amount <= 0 or p_base_amount <= 0 or p_exchange_rate <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if exists (
    select 1 from bills
    where room_id = v_bill.room_id
      and id <> p_bill_id
      and lower(title) = lower(btrim(p_title))
      and status <> 'deleted'
  ) then
    raise exception 'DUPLICATE_BILL_TITLE';
  end if;
  if not exists (select 1 from users where id = p_payer_user_id and room_id = v_bill.room_id) then
    raise exception 'INVALID_PAYER';
  end if;
  v_n := array_length(p_split_among, 1);
  if v_n is null or v_n = 0 then raise exception 'NO_PARTICIPANTS'; end if;
  foreach v_pid in array p_split_among loop
    if not exists (select 1 from users where id = v_pid and room_id = v_bill.room_id) then
      raise exception 'INVALID_PARTICIPANT';
    end if;
  end loop;

  update bills set
    title             = btrim(p_title),
    note              = nullif(btrim(coalesce(p_note, '')), ''),
    original_currency = upper(p_original_currency),
    original_amount   = p_original_amount,
    exchange_rate     = p_exchange_rate,
    base_amount       = p_base_amount,
    payer_user_id     = p_payer_user_id,
    split_among       = p_split_among
  where id = p_bill_id
  returning * into v_bill;

  insert into action_logs (room_id, actor_user_id, action_type, message, metadata)
  values (v_bill.room_id, v_creator.id, 'bill_updated',
          format('%s edited %s', v_creator.nickname, v_bill.title),
          jsonb_build_object('bill_id', v_bill.id));

  return to_jsonb(v_bill);
end;
$$;

-- =============================================================================
-- Two-party soft delete.
-- Participants of a bill = the payer plus everyone in split_among.
-- =============================================================================
create or replace function request_bill_delete(p_bill_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token        uuid := app_current_token();
  v_bill         bills;
  v_me           users;
  v_participants uuid[];
begin
  if v_token is null then raise exception 'MISSING_USER_TOKEN'; end if;
  select * into v_bill from bills where id = p_bill_id;
  if not found then raise exception 'BILL_NOT_FOUND'; end if;
  if v_bill.status <> 'active' then raise exception 'BILL_NOT_ACTIVE'; end if;

  select * into v_me from users where room_id = v_bill.room_id and token = v_token;
  if not found then raise exception 'NOT_A_MEMBER'; end if;

  v_participants := array(
    select distinct x from unnest(array[v_bill.payer_user_id] || v_bill.split_among) as x
  );
  if not (v_me.id = any(v_participants)) then raise exception 'NOT_A_PARTICIPANT'; end if;

  if coalesce(array_length(v_participants, 1), 0) <= 1 then
    -- Sole participant: no second party exists, so soft-delete immediately.
    update bills set status = 'deleted', delete_requested_by = v_me.id
    where id = p_bill_id returning * into v_bill;
  else
    update bills set status = 'pending_delete', delete_requested_by = v_me.id
    where id = p_bill_id returning * into v_bill;
  end if;

  insert into action_logs (room_id, actor_user_id, action_type, message, metadata)
  values (v_bill.room_id, v_me.id, 'bill_delete_requested',
          format('%s requested to delete %s', v_me.nickname, v_bill.title),
          jsonb_build_object('bill_id', v_bill.id));
  return to_jsonb(v_bill);
end;
$$;

create or replace function confirm_bill_delete(p_bill_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token        uuid := app_current_token();
  v_bill         bills;
  v_me           users;
  v_participants uuid[];
begin
  if v_token is null then raise exception 'MISSING_USER_TOKEN'; end if;
  select * into v_bill from bills where id = p_bill_id;
  if not found then raise exception 'BILL_NOT_FOUND'; end if;
  if v_bill.status <> 'pending_delete' then raise exception 'NOT_PENDING_DELETE'; end if;

  select * into v_me from users where room_id = v_bill.room_id and token = v_token;
  if not found then raise exception 'NOT_A_MEMBER'; end if;

  v_participants := array(
    select distinct x from unnest(array[v_bill.payer_user_id] || v_bill.split_among) as x
  );
  if not (v_me.id = any(v_participants)) then raise exception 'NOT_A_PARTICIPANT'; end if;
  -- The confirmer must be a DIFFERENT participant than the requester.
  if v_me.id = v_bill.delete_requested_by then raise exception 'NEED_OTHER_PARTY'; end if;

  update bills set status = 'deleted' where id = p_bill_id returning * into v_bill;

  insert into action_logs (room_id, actor_user_id, action_type, message, metadata)
  values (v_bill.room_id, v_me.id, 'bill_deleted',
          format('%s confirmed deletion of %s', v_me.nickname, v_bill.title),
          jsonb_build_object('bill_id', v_bill.id));
  return to_jsonb(v_bill);
end;
$$;

grant execute on function
  update_bill(uuid, text, text, text, numeric, numeric, numeric, uuid, uuid[])
  to anon, authenticated;
grant execute on function request_bill_delete(uuid) to anon, authenticated;
grant execute on function confirm_bill_delete(uuid) to anon, authenticated;
