-- =============================================================================
-- 00004_bill_split_among.sql
-- Phase 5 refactor: make the "For Whom" (debtors) list explicit per bill.
--
-- Previously add_bill split a bill across a participant list and materialized
-- one `debts` row per participant; the optimize-debts function then summed
-- those debts. That worked, but the real split lived only in derived debt rows
-- and the frontend defaulted to "everyone".
--
-- New model: the bill itself records exactly who it is for, in `split_among`.
-- base_amount is divided equally across ONLY those users. This column is now
-- the single source of truth for net-balance calculation (see the updated
-- optimize-debts Edge Function). The `debts` table is reserved for the explicit
-- repayment state machine (Unpaid -> Pending_Confirm -> Settled) and is no
-- longer auto-generated here, so it can never drift from an edited bill.
-- =============================================================================

alter table bills
  add column split_among uuid[] not null default '{}'::uuid[];

comment on column bills.split_among is
  'Explicit list of member ids this bill is split among (the "For Whom"/debtors). base_amount is divided equally across these users only. Source of truth for net-balance calculation.';

-- Backfill existing bills from their previously-generated debts
-- (debtors + the payer = everyone the bill involved).
update bills b
set split_among = sub.ids
from (
  select bill_id, array_agg(distinct uid) as ids
  from (
    select bill_id, from_user_id as uid from debts where bill_id is not null
    union
    select bill_id, to_user_id   as uid from debts where bill_id is not null
  ) e
  group by bill_id
) sub
where b.id = sub.bill_id
  and array_length(b.split_among, 1) is null;

-- ---- Replace add_bill: store split_among, no longer materialize debts -------
-- (DROP first: the parameter is renamed, which CREATE OR REPLACE disallows.)
drop function if exists add_bill(uuid, text, text, text, numeric, numeric, numeric, uuid, uuid[]);

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
  if v_token is null then
    raise exception 'MISSING_USER_TOKEN';
  end if;

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

  v_n := array_length(p_split_among, 1);
  if v_n is null or v_n = 0 then
    raise exception 'NO_PARTICIPANTS';
  end if;

  -- Every "For Whom" entry must be a member of this room.
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
