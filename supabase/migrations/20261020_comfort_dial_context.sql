-- Comfort Dial: what we know about a winner beyond the form. Run after 20261019_comfort_dial_admin.sql. Safe to re-run.
--
--   turns.context     the visit, captured when they turn: first and this visit's landing page and referrer, pages
--                     viewed, visits so far, device, time on site, ad click ids, and the rough place from their IP
--                     (city, ZIP, in ARR's service area or not). No query strings except utm_* and click ids.
--   entries.context   the turn's context, copied when they claim.
--   entries.home      the county record for the address they gave: year built, size, heating, central air, ...
--   entries.prior     earlier contact found by their phone (Monday leads board, Klaviyo) and other dial codes at
--                     the same address.
--   entries.address_key  normalized "STREET|ZIP" (lib/address.ts), so other codes at the same home can be found.
--
-- None of it is shown back to the visitor. It goes to the CSR (Monday item, admin) and to Klaviyo.

alter table public.comfort_dial_turns add column if not exists context jsonb;
alter table public.comfort_dial_entries add column if not exists context jsonb;
alter table public.comfort_dial_entries add column if not exists home jsonb;
alter table public.comfort_dial_entries add column if not exists prior jsonb;
alter table public.comfort_dial_entries add column if not exists address_key text;
create index if not exists comfort_dial_entries_address_key on public.comfort_dial_entries (address_key) where address_key is not null;

-- One home by its normalized address key, from the pricing app's county tables. The primary card and the newest
-- assessment year win. Null when the address isn't on file.
create or replace function public.comfort_dial_home(p_key text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'propertyKey', a.property_key, 'county', p.county, 'municipality', p.municipality, 'township', p.township,
    'yearBuilt', r.year_built, 'sqft', r.sqft, 'stories', r.stories, 'style', r.style, 'heating', r.heating_raw,
    'centralAir', r.central_air, 'basement', r.basement, 'basementFinish', r.basement_finish, 'rooms', r.rooms,
    'assessedYear', r.source_year
  ))
  from property_addresses a
  join properties p on p.property_key = a.property_key
  left join lateral (
    select * from residential_characteristics rc
    where rc.property_key = a.property_key
    order by rc.is_primary_card desc, rc.source_year desc, rc.card_number
    limit 1
  ) r on true
  where a.normalized_key = p_key
  order by a.is_primary desc
  limit 1
$$;
revoke execute on function public.comfort_dial_home(text) from public, anon, authenticated;
