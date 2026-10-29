-- Comfort Dial: CSR logins. Run after 20261021_comfort_dial_oauth.sql. Safe to re-run.
--
--   comfort_dial_admins.role   admin: everything (the default, so everyone already on the list stays an admin).
--                              csr: the Codes tab only: find a code, mark it redeemed, text it again.
--   comfort_dial_audit         a role change is action 'role', detail { from, to }.
--
-- Until this runs the admin works as before and everyone is an admin; only adding a CSR or changing a role fails.

alter table public.comfort_dial_admins add column if not exists role text not null default 'admin';
do $$ begin
  alter table public.comfort_dial_admins add constraint comfort_dial_admins_role check (role in ('admin', 'csr'));
exception when duplicate_object then null; end $$;
