-- =============================================================================
-- 00003_add_bill_rpc.sql
-- Phase 5: atomically record an expense and its derived debts.
--
-- Adding a bill is a multi-row write that must be all-or-nothing:
--   1. insert the bill (original + converted amounts, frozen FX rate)
--   2. split base_amount equally across the participants and insert one debt
--      per participant (excluding the payer) owing their share to the payer
--   3. append an activity-log line
-- These debts are what the Phase 2 `optimize-debts` function reads to compute
-- net balances, so they must be created here for settlement to work.
--
-- SECURITY DEFINER: identity is taken from the x-user-token header, never from
-- the request body. The function validates room membership for the caller, the
-- payer, and every participant.
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
  p_participant_ids   uuid[]
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
  v_n       int;
  v_share   numeric(18,4);
  v_pid     uuid;
begin
  if v_token is null then
    raise exception 'MISSING_USER_TOKEN';
  end if;

  -- Caller must be a member of the room; the bill is attributed to them.
  select * into v_creator from users where room_id = p_room_id and token = v_token;
  if not found then
    raise exception 'NOT_A_MEMBER';
  end if;

  if coalesce(btrim(p_title), '') = '' then
    raise exception 'TITLE_REQUIRED';
  end if;
  if p_original_amount <= 0 or p_base_amount <= 0 or p_exchange_rate <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if not exists (select 1 from users where id = p_payer_user_id and room_id = p_room_id) then
    raise exception 'INVALID_PAYER';
  end if;

  v_n := array_length(p_participant_ids, 1);
  if v_n is null or v_n = 0 then
    raise exception 'NO_PARTICIPANTS';
  end if;

  insert into bills (
    room_id, creator_user_id, payer_user_id, title, note,
    original_currency, original_amount, exchange_rate, base_amount
  )
  values (
    p_room_id, v_creator.id, p_payer_user_id, btrim(p_title),
    nullif(btrim(coalesce(p_note, '')), ''),
    upper(p_original_currency), p_original_amount, p_exchange_rate, p_base_amount
  )
  returning * into v_bill;

  -- Equal split. Each participant other than the payer owes one share.
  v_share := round(p_base_amount / v_n, 2);
  foreach v_pid in array p_participant_ids loop
    if not exists (select 1 from users where id = v_pid and room_id = p_room_id) then
      raise exception 'INVALID_PARTICIPANT';
    end if;
    if v_pid <> p_payer_user_id then
      insert into debts (room_id, bill_id, from_user_id, to_user_id, amount, status)
      values (p_room_id, v_bill.id, v_pid, p_payer_user_id, v_share, 'unpaid');
    end if;
  end loop;

  insert into action_logs (room_id, actor_user_id, action_type, message, metadata)
  values (
    p_room_id, v_creator.id, 'bill_created',
    format('%s added %s (%s %s)',
           v_creator.nickname, btrim(p_title),
           trim_scale(p_original_amount), upper(p_original_currency)),
    jsonb_build_object('bill_id', v_bill.id)
  );

  return to_jsonb(v_bill);
end;
$$;

grant execute on function
  add_bill(uuid, text, text, text, numeric, numeric, numeric, uuid, uuid[])
  to anon, authenticated;
