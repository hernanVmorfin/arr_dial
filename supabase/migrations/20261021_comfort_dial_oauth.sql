-- Comfort Dial: OAuth tokens that expire, kept where every Worker isolate can see them. Run after
-- 20261020_comfort_dial_context.sql. Safe to re-run.
--
--   comfort_dial_oauth   one row per provider (today only 'podium'): the newest access token, the refresh token that
--                        goes with it, and when the access token expires. The Worker refreshes shortly before expiry
--                        and writes the new pair here, so other isolates use it instead of refreshing again, and a
--                        refresh token Podium hands back is never lost when the isolate that got it goes away.
--
-- Until this runs, texts still go out: each isolate keeps its token in memory and refreshes for itself.
-- These are live credentials: RLS on with no policies, like every comfort_dial_* table, so only the server's secret
-- key can read them.

create table if not exists public.comfort_dial_oauth (
  provider       text primary key,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,
  updated_at     timestamptz not null default now()
);

alter table public.comfort_dial_oauth enable row level security;
revoke all on public.comfort_dial_oauth from anon, authenticated;
