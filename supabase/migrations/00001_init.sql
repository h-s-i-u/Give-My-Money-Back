-- =============================================================================
-- 00001_init.sql
-- Phase 1: Database schema for the login-free, multi-user, real-time
-- bill-splitting system (Kahoot-style).
--
-- Identity model:
--   There is NO Supabase Auth. Each browser generates a random UUID that is
--   stored in localStorage and acts as the user's bearer "token". The frontend
--   sends this token on every request via a custom HTTP header:
--
--       x-user-token: <uuid>
--
--   PostgREST exposes incoming headers through the `request.headers` GUC, so
--   RLS policies can read the caller's token with app_current_token() below.
--   This token is the credential that ties a request to a row in `users`.
--
-- File layout (execution order matters):
--   SECTION 1 - Extensions
--   SECTION 2 - Tables, constraints, indexes   (all relations exist first)
--   SECTION 3 - Functions                        (may reference the tables)
--   SECTION 4 - Triggers                         (reference SECTION 3 functions)
--   SECTION 5 - Row Level Security & grants
--   SECTION 6 - Realtime publication
-- =============================================================================


-- =============================================================================
-- SECTION 1 - Extensions
-- =============================================================================
create extension if not exists "pgcrypto";          -- gen_random_uuid()


-- =============================================================================
-- SECTION 2 - Tables, constraints, indexes
-- All CREATE TABLE statements run before any function so that every relation
-- referenced inside a SQL-language function already exists.
-- =============================================================================

-- ---- rooms ----------------------------------------------------------------
create table rooms (
  id              uuid        primary key default gen_random_uuid(),
  room_code       text        not null unique,                 -- short human-typed join code
  name            text,
  base_currency   char(3)     not null default 'TWD',          -- ISO-4217 settlement currency
  status          text        not null default 'active'
                              check (status in ('active', 'settled', 'archived')),
  -- Host is a member of this room. Nullable because the room row is created a
  -- moment before its host `users` row exists (resolved in the same flow).
  host_user_id    uuid,
  created_at      timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),          -- drives the 1-month idle archival
  settled_at      timestamptz,
  archived_at     timestamptz
);

comment on column rooms.room_code is 'Short code users type to join; the de-facto access key to the room.';
comment on column rooms.last_activity_at is 'Updated on any bill/debt activity; a room idle for 1 month is auto-archived by a scheduled job.';

create index idx_rooms_room_code        on rooms (room_code);
create index idx_rooms_last_activity_at on rooms (last_activity_at);
create index idx_rooms_status           on rooms (status);

-- ---- users  (room participants — one row per (browser-token, room)) -------
create table users (
  id          uuid        primary key default gen_random_uuid(),
  room_id     uuid        not null references rooms (id) on delete cascade,
  token       uuid        not null,                  -- the localStorage UUID (credential)
  nickname    text        not null,
  is_host     boolean     not null default false,
  created_at  timestamptz not null default now(),
  -- The same browser-token may join many rooms, but only once per room.
  -- This unique constraint is what makes "reconnect = re-claim identity" work.
  unique (room_id, token)
);

comment on column users.token is 'Random UUID generated on the client and stored in localStorage. Acts as the bearer credential; sent as the x-user-token header.';

create index idx_users_room_id on users (room_id);
create index idx_users_token   on users (token);

-- Now that `users` exists, wire the host FK on rooms.
alter table rooms
  add constraint rooms_host_user_fk
  foreign key (host_user_id) references users (id) on delete set null;

-- At most one host per room.
create unique index uniq_room_single_host
  on users (room_id)
  where is_host;

-- ---- bills  (each row is one expense / payment somebody fronted) ----------
create table bills (
  id               uuid        primary key default gen_random_uuid(),
  room_id          uuid        not null references rooms (id) on delete cascade,
  creator_user_id  uuid        not null references users (id) on delete restrict,
  payer_user_id    uuid        not null references users (id) on delete restrict,  -- who fronted the money
  title            text        not null,
  note             text,

  -- Multi-currency: keep both the original input AND the converted base amount,
  -- plus the exact rate used, so later FX drift never changes the settlement.
  original_currency char(3)    not null,
  original_amount   numeric(18,4) not null check (original_amount > 0),
  exchange_rate     numeric(20,10) not null check (exchange_rate > 0),  -- 1 original_currency = X base_currency
  base_amount       numeric(18,4) not null check (base_amount > 0),     -- original_amount * exchange_rate

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on column bills.exchange_rate is 'Rate captured at creation time from the external FX API; frozen to keep settlements stable.';
comment on column bills.base_amount is 'original_amount converted to the room base currency at exchange_rate, stored to avoid recomputation/FX drift.';

create index idx_bills_room_id     on bills (room_id);
create index idx_bills_creator     on bills (creator_user_id);
create index idx_bills_payer       on bills (payer_user_id);
create index idx_bills_room_created on bills (room_id, created_at desc);

-- ---- debts  (pairwise obligations + two-sided repayment state machine) ----
-- Rows may come straight from a bill split OR from the greedy simplification.
create table debts (
  id            uuid        primary key default gen_random_uuid(),
  room_id       uuid        not null references rooms (id) on delete cascade,
  bill_id       uuid        references bills (id) on delete set null,  -- null = simplified/aggregated debt
  from_user_id  uuid        not null references users (id) on delete restrict,  -- debtor (owes)
  to_user_id    uuid        not null references users (id) on delete restrict,  -- creditor (fronted)
  amount        numeric(18,4) not null check (amount > 0),            -- always in room base currency
  status        text        not null default 'unpaid'
                            check (status in ('unpaid', 'pending_confirm', 'settled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  settled_at    timestamptz,
  check (from_user_id <> to_user_id)
);

comment on table debts is 'Pairwise debt with a two-phase confirmation state machine. Never hard-deleted; status drives the lifecycle.';
comment on column debts.status is 'unpaid -> pending_confirm (debtor pressed "I paid") -> settled (creditor pressed "I received"). Creditor may bounce pending_confirm back to unpaid.';

create index idx_debts_room_id   on debts (room_id);
create index idx_debts_bill_id   on debts (bill_id);
create index idx_debts_from_user on debts (from_user_id);
create index idx_debts_to_user   on debts (to_user_id);
create index idx_debts_status    on debts (room_id, status);

-- ---- action_logs  (append-only feed powering the realtime activity wall) --
create table action_logs (
  id             uuid        primary key default gen_random_uuid(),
  room_id        uuid        not null references rooms (id) on delete cascade,
  actor_user_id  uuid        references users (id) on delete set null,
  action_type    text        not null,                       -- e.g. bill_created, debt_paid, debt_confirmed, room_settled
  message        text        not null,                       -- pre-rendered line for the activity wall
  metadata       jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index idx_action_logs_room_created on action_logs (room_id, created_at desc);
create index idx_action_logs_actor        on action_logs (actor_user_id);


-- =============================================================================
-- SECTION 3 - Functions
-- All tables now exist, so SQL-language functions that reference them parse
-- successfully at creation time.
-- =============================================================================

-- Returns the caller's localStorage token taken from the x-user-token header.
-- Returns NULL when the header is missing or empty.
create or replace function app_current_token()
returns uuid
language sql
stable
as $$
  select nullif(
           current_setting('request.headers', true)::json ->> 'x-user-token',
           ''
         )::uuid
$$;

-- True if the caller's token belongs to a user that is a member of `p_room_id`.
-- SECURITY DEFINER so membership can be checked without recursing into the
-- RLS policy of `users` itself.
create or replace function app_is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from users u
    where u.room_id = p_room_id
      and u.token   = app_current_token()
  )
$$;

-- Returns the users.id (surrogate PK) of the caller within a given room.
create or replace function app_room_user_id(p_room_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from users u
  where u.room_id = p_room_id
    and u.token   = app_current_token()
$$;

-- True if the caller is the Host of `p_room_id`.
create or replace function app_is_room_host(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from users u
    where u.room_id = p_room_id
      and u.token   = app_current_token()
      and u.is_host = true
  )
$$;

-- Generic updated_at touch trigger.
create or replace function app_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Enforce the repayment state machine and column immutability at the DB level.
-- This is the authoritative guard: even if RLS lets the right party UPDATE the
-- row, only valid transitions performed by the correct party are accepted.
create or replace function app_enforce_debt_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := app_current_token();
begin
  -- Core financial fields are immutable after creation.
  if new.from_user_id is distinct from old.from_user_id
     or new.to_user_id is distinct from old.to_user_id
     or new.amount     is distinct from old.amount
     or new.room_id    is distinct from old.room_id
     or new.bill_id    is distinct from old.bill_id then
    raise exception 'Debt core fields (parties/amount/room/bill) are immutable';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.status = 'unpaid' and new.status = 'pending_confirm' then
    -- Only the debtor can declare "I have paid".
    if not exists (select 1 from users u
                   where u.id = old.from_user_id and u.token = caller) then
      raise exception 'Only the debtor may mark a debt as paid';
    end if;
    new.settled_at := null;

  elsif old.status = 'pending_confirm' and new.status = 'settled' then
    -- Only the creditor can confirm receipt.
    if not exists (select 1 from users u
                   where u.id = old.to_user_id and u.token = caller) then
      raise exception 'Only the creditor may confirm receipt';
    end if;
    new.settled_at := now();

  elsif old.status = 'pending_confirm' and new.status = 'unpaid' then
    -- Creditor rejects the claimed payment, sending it back to unpaid.
    if not exists (select 1 from users u
                   where u.id = old.to_user_id and u.token = caller) then
      raise exception 'Only the creditor may reject a claimed payment';
    end if;

  else
    raise exception 'Invalid debt status transition: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

-- Activity bookkeeping: any bill/debt write bumps rooms.last_activity_at,
-- which the idle-archival job relies on.
create or replace function app_touch_room_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid := coalesce(new.room_id, old.room_id);
begin
  update rooms set last_activity_at = now() where id = rid;
  return coalesce(new, old);
end;
$$;


-- =============================================================================
-- SECTION 4 - Triggers
-- Created after their functions exist.
-- =============================================================================
create trigger trg_bills_updated_at
  before update on bills
  for each row execute function app_touch_updated_at();

create trigger trg_debts_updated_at
  before update on debts
  for each row execute function app_touch_updated_at();

create trigger trg_debts_transition
  before update on debts
  for each row execute function app_enforce_debt_transition();

create trigger trg_bills_touch_room
  after insert or update on bills
  for each row execute function app_touch_room_activity();

create trigger trg_debts_touch_room
  after insert or update on debts
  for each row execute function app_touch_room_activity();


-- =============================================================================
-- SECTION 5 - Row Level Security & grants
-- =============================================================================
alter table rooms       enable row level security;
alter table users       enable row level security;
alter table bills       enable row level security;
alter table debts       enable row level security;
alter table action_logs enable row level security;

-- The anon role is what the Supabase anon key maps to. Grant table privileges;
-- RLS below narrows what each statement can actually touch. No DELETE is
-- granted anywhere — the system forbids hard deletes by design.
grant usage on schema public to anon, authenticated;
grant select, insert, update on
  rooms, users, bills, debts, action_logs
  to anon, authenticated;

-- ---- rooms ----------------------------------------------------------------
-- Anyone may look up a room (needed to join by code before becoming a member).
-- The room_code is the access key; room contents are protected by their own
-- per-table member policies.
create policy rooms_select_public
  on rooms for select
  using (true);

-- Anyone may create a room.
create policy rooms_insert_anyone
  on rooms for insert
  with check (true);

-- Only the Host may modify the room (rename, settle, archive, set host_user_id).
create policy rooms_update_host_only
  on rooms for update
  using (app_is_room_host(id))
  with check (app_is_room_host(id));

-- ---- users ----------------------------------------------------------------
-- Members can see everyone in their own room (needed for names, debts UI).
create policy users_select_members
  on users for select
  using (app_is_room_member(room_id));

-- Joining a room: callers may only insert a row bound to THEIR OWN token, so
-- nobody can fabricate a membership under someone else's identity. The Host
-- flag may only be set on the very first member of a room (the creator).
create policy users_insert_self
  on users for insert
  with check (
    token = app_current_token()
    and (
      is_host = false
      or not exists (select 1 from users u where u.room_id = users.room_id)
    )
  );

-- A user may edit only their own row (e.g. change nickname). is_host cannot be
-- escalated here because only the creator path above can ever set it true, and
-- the partial unique index forbids a second host.
create policy users_update_self
  on users for update
  using (token = app_current_token())
  with check (token = app_current_token() and is_host = false);

-- ---- bills ----------------------------------------------------------------
create policy bills_select_members
  on bills for select
  using (app_is_room_member(room_id));

-- Any member may add a bill, but the recorded creator must be the caller.
create policy bills_insert_members
  on bills for insert
  with check (
    app_is_room_member(room_id)
    and creator_user_id = app_room_user_id(room_id)
  );

-- Only the original creator may edit a bill, and they cannot reassign creation.
create policy bills_update_creator_only
  on bills for update
  using (creator_user_id = app_room_user_id(room_id))
  with check (creator_user_id = app_room_user_id(room_id));

-- ---- debts ----------------------------------------------------------------
create policy debts_select_members
  on debts for select
  using (app_is_room_member(room_id));

-- Members may create debt rows (from a bill split or the simplification pass)
-- within their own room.
create policy debts_insert_members
  on debts for insert
  with check (app_is_room_member(room_id));

-- Only the two parties to a debt may update it; the BEFORE trigger then
-- enforces which party is allowed which transition.
create policy debts_update_parties_only
  on debts for update
  using (
    app_room_user_id(room_id) in (from_user_id, to_user_id)
  )
  with check (
    app_room_user_id(room_id) in (from_user_id, to_user_id)
  );

-- ---- action_logs  (append-only) -------------------------------------------
create policy action_logs_select_members
  on action_logs for select
  using (app_is_room_member(room_id));

-- Members may append a log entry, but only attributed to themselves.
create policy action_logs_insert_members
  on action_logs for insert
  with check (
    app_is_room_member(room_id)
    and actor_user_id = app_room_user_id(room_id)
  );
-- No UPDATE/DELETE policy => the activity feed is immutable.


-- =============================================================================
-- SECTION 6 - Realtime publication
-- Expose the room-scoped tables so Supabase Realtime can broadcast changes to
-- all connected members.
-- =============================================================================
alter publication supabase_realtime add table bills;
alter publication supabase_realtime add table debts;
alter publication supabase_realtime add table action_logs;
alter publication supabase_realtime add table users;
alter publication supabase_realtime add table rooms;
