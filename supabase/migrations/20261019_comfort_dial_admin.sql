-- Comfort Dial admin (/dial/admin): published configs, who may sign in, an audit trail, and the results query.
-- Run once in the Supabase SQL editor for project dienlkpgmgetkkdyduap, after 20261016_comfort_dial.sql. Safe to
-- re-run. The dial keeps working before this runs (it falls back to data/dial.json); the admin needs it.
--
--   comfort_dial_config   every published config, newest = live. Rows are never edited; a rollback publishes an old
--                         config again as a new version. turns.config_version says which odds picked each gift.
--   comfort_dial_admins   the allowlist. Passwords live in Supabase Auth (same project); an Auth user who is not on
--                         this list can't sign in to the admin.
--   comfort_dial_audit    sign-ins, publishes, and every change to a code (redeem, void, extend, resend).
--
-- After running it, add the first admin: create the user in Authentication > Users (email + password, auto-confirm),
-- then: insert into public.comfort_dial_admins (email, name) values ('jason@arrhvac.com', 'Jason');

create table if not exists public.comfort_dial_config (
  version     integer primary key check (version > 0),
  config      jsonb not null,
  note        text,
  created_by  text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.comfort_dial_admins (
  email       text primary key check (email = lower(email)),
  name        text not null,
  created_at  timestamptz not null default now(),
  created_by  text
);

create table if not exists public.comfort_dial_audit (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       text not null,                   -- admin email, or the email tried for a failed sign-in
  action      text not null,                   -- login, login_failed, publish, pause, resume, rollback, redeem, void,
                                               -- restore, extend, resend, admin_add, admin_remove, password
  target      text,                            -- a code, a version number, or an admin email
  detail      jsonb,
  ip          text
);
create index if not exists comfort_dial_audit_target on public.comfort_dial_audit (target, at desc);
create index if not exists comfort_dial_audit_action on public.comfort_dial_audit (action, at desc);

-- Which config version picked the gift; void for codes cancelled in the admin.
alter table public.comfort_dial_turns add column if not exists config_version integer;
alter table public.comfort_dial_entries add column if not exists voided_at timestamptz;
alter table public.comfort_dial_entries add column if not exists voided_note text;

-- New gifts come from the admin, so the fixed list of gift ids becomes a format check. The admin never deletes a
-- gift that was published (it can only switch it off), so every stored id stays resolvable.
alter table public.comfort_dial_turns drop constraint if exists comfort_dial_turns_gift_check;
alter table public.comfort_dial_entries drop constraint if exists comfort_dial_entries_gift_check;
do $$ begin
  alter table public.comfort_dial_turns add constraint comfort_dial_turns_gift_id check (gift ~ '^[a-z0-9_]{2,24}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.comfort_dial_entries add constraint comfort_dial_entries_gift_id check (gift ~ '^[a-z0-9_]{2,24}$');
exception when duplicate_object then null; end $$;

create index if not exists comfort_dial_turns_created on public.comfort_dial_turns (created_at);
create index if not exists comfort_dial_entries_created on public.comfort_dial_entries (created_at desc);
create index if not exists comfort_dial_entries_redeemed on public.comfort_dial_entries (redeemed_at) where redeemed_at is not null;

-- Results for [p_since, p_until). Mirrors stats() in src/lib/db-memory.ts; days are Chicago dates.
create or replace function public.comfort_dial_stats(p_since timestamptz, p_until timestamptz)
returns jsonb
language sql
stable
set search_path = public
as $$
  with
  t as (select gift, device, coalesce(config_version, 0) as v, created_at from comfort_dial_turns
        where created_at >= p_since and created_at < p_until),
  e as (select gift, utm, sms_marketing, created_at, redeemed_at, voided_at from comfort_dial_entries
        where created_at >= p_since and created_at < p_until),
  r as (select redeemed_at from comfort_dial_entries where redeemed_at >= p_since and redeemed_at < p_until),
  g as (
    select gift, sum(tc)::int as turns, sum(cc)::int as claims, sum(rc)::int as redeemed from (
      select gift, 1 as tc, 0 as cc, 0 as rc from t
      union all select gift, 0, 1, (redeemed_at is not null)::int from e
    ) x group by gift
  ),
  d as (
    select day, sum(tc)::int as turns, sum(cc)::int as claims, sum(rc)::int as redeemed from (
      select to_char(created_at at time zone 'America/Chicago', 'YYYY-MM-DD') as day, 1 as tc, 0 as cc, 0 as rc from t
      union all select to_char(created_at at time zone 'America/Chicago', 'YYYY-MM-DD'), 0, 1, 0 from e
      union all select to_char(redeemed_at at time zone 'America/Chicago', 'YYYY-MM-DD'), 0, 0, 1 from r
    ) x group by day
  ),
  s as (
    select coalesce(nullif(utm->>'utm_source', ''), '(direct)') as source, count(*)::int as claims,
           count(redeemed_at)::int as redeemed
    from e group by 1
  )
  select jsonb_build_object(
    'turns',     (select count(*) from t),
    'players',   (select count(distinct device) from t),
    'claims',    (select count(*) from e),
    'redeemed',  (select count(redeemed_at) from e),
    'voided',    (select count(voided_at) from e),
    'reminders', (select count(*) from e where sms_marketing),
    'versions',  (select coalesce(jsonb_agg(v order by v), '[]'::jsonb) from (select distinct v from t) x),
    'byGift',    (select coalesce(jsonb_agg(jsonb_build_object('gift', gift, 'turns', turns, 'claims', claims, 'redeemed', redeemed) order by gift), '[]'::jsonb) from g),
    'byDay',     (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'turns', turns, 'claims', claims, 'redeemed', redeemed) order by day), '[]'::jsonb) from d),
    'sources',   (select coalesce(jsonb_agg(jsonb_build_object('source', source, 'claims', claims, 'redeemed', redeemed) order by claims desc, source), '[]'::jsonb) from s)
  );
$$;

alter table public.comfort_dial_config enable row level security;
alter table public.comfort_dial_admins enable row level security;
alter table public.comfort_dial_audit enable row level security;
revoke all on public.comfort_dial_config, public.comfort_dial_admins, public.comfort_dial_audit from anon, authenticated;
revoke execute on function public.comfort_dial_stats(timestamptz, timestamptz) from public, anon, authenticated;
