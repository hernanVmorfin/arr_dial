# Comfort Dial runbook

Setup, launch, the 50/50 test, and operations. Nothing reaches visitors until step 7 (the Webflow embed).

## Launch checklist

In order. Each step is safe to stop after.

1. **Supabase**: SQL Editor in project `dienlkpgmgetkkdyduap` (the Instant Pricing project) → run
   `supabase/migrations/20261016_comfort_dial.sql`. It only creates the three `comfort_dial_*` tables. If an empty
   `dial_entries` table exists from the earlier PR #10 migration, it can be dropped; nothing reads it.
2. **Webflow Cloud app**: Webflow → site → Webflow Cloud → new app from GitHub `hernanVmorfin/arr_dial`, branch
   `main`, root directory `/` (the repo root), mount path **`/dial`**. ARR already runs two apps this way
   (`/pricing-app` and `/instant_pricing`). The builder runs `astro build`; `dial.js` is built by a hook in
   `astro.config.mjs`.
3. **Environment variables** (Webflow Cloud → app → environment; runtime only, not needed at build). Never put a
   secret in the Webflow embed. Do **not** set `MOUNT_PATH`.

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | `https://dienlkpgmgetkkdyduap.supabase.co` |
   | `SUPABASE_SECRET_KEY` | The server-only secret key (same one the pricing app uses), not the anon key |
   | `MONDAY_API_TOKEN`, `MONDAY_BOARD_ID` | Same as the pricing app (board 18432287526) |
   | `MONDAY_CODE_STATUS_COLUMN` | Id of the new "Code status" column (step 5) |
   | `MONDAY_WEBHOOK_SECRET` | A long random string; also goes in the webhook URL (step 5) |
   | `PODIUM_API_TOKEN`, `PODIUM_LOCATION_UID` | Same as the pricing app |
   | `KLAVIYO_PRIVATE_KEY` | Klaviyo → Settings → API keys → private key with write access to Profiles, Events and Subscriptions |
   | `KLAVIYO_SMS_LIST_ID` | Optional: the list reminder opt-ins join |
   | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare → Turnstile → add widget for `alwaysreadyrepair.com` (Managed or Invisible) |

   `wrangler.json` keeps `"keep_vars": true` so deploys don't wipe these (the pricing app learned this the hard way).
4. **Check the deploy**: `https://www.alwaysreadyrepair.com/dial/api/health?deep=1`
   - `dial: true`, `integrations.supabase: "ok"`, and every integration you configured is `true`.
   - **`yourIp` must be your own public IP.** If it shows the same address for everyone (a Webflow proxy), set
     `DIAL_IP_LIMITS=off`, or the per-IP limits will block real visitors.
   - `https://www.alwaysreadyrepair.com/dial/` should open the dial.
5. **Monday**:
   - Add a status column **Code status** to the Instant Pricing Leads board with labels `Issued`, `Redeemed`,
     `Expired`. Put its column id in `MONDAY_CODE_STATUS_COLUMN`.
   - Board → Integrate → Webhooks → "When a column changes, send a webhook" → column Code status → URL
     `https://www.alwaysreadyrepair.com/dial/api/redeemed?key=<MONDAY_WEBHOOK_SECRET>`. Monday sends a challenge
     first; the route answers it.
6. **Sera**: one discount line per gift (`Comfort Dial $20`, `$50 ducts`, `$50 water heater`, `Free service call`,
   `Free year membership`) so redemptions show up in revenue reports.
7. **Webflow embed** (the step that reaches visitors): Site settings → Backups → manual backup, then Site settings →
   Custom code → Footer code:

   ```html
   <script>window.__ARR_DIAL__={split:0.5}</script>
   <script type="module" src="/dial/dial.js"></script>
   ```

   Publish. The 50/50 test is now running.
8. **Live test**: open `https://www.alwaysreadyrepair.com/?dial=1`, turn, claim with your own phone. Confirm the
   text, the Monday item and the Klaviyo event. Then run `ARRDial.reset()` in the browser console and delete your row
   in `comfort_dial_entries` (and its turn in `comfort_dial_turns`). Each test needs a different phone.
9. **Klaviyo flow**: build it from [KLAVIYO.md](KLAVIYO.md) once the first event has created the
   "Comfort Dial Won" metric, then set it live.
10. **GA4**: in GTM, add GA4 event tags for the `dial_*` events below, and a user property `dial_variant` from the
    data layer.
11. **Rules**: after the legal read, set `"rulesFinal": true` in `data/dial.json` and push. The draft banner on
    `/dial/rules` goes away.

**Rollback** at any point: remove the two embed lines and republish. The app and tables can stay; nothing calls
them without the embed. To pause without republishing Webflow, remove `SUPABASE_SECRET_KEY`: the popup stops opening
by itself and buttons show a call-us message.

## The 50/50 test

`split: 0.5` puts each new visitor in the `dial` or `control` group (kept in their browser). Control never sees the
popup open by itself or the side tab; `?dial=1` links and buttons still work for them, so ads can point anywhere.

Every data-layer event carries `dial_variant`. Compare, per visitor, by group for 2 weeks: phone taps
(`dial_call_clicked` plus the site's own call tracking), Book Service visits, and booked jobs. If the dial group
books more, set `split: 1`. If it books less, set `split: 0` (or remove the embed).

| Event | When |
|---|---|
| `dial_assigned` | Every page view (carries the group) |
| `dial_opened` | Opened; `trigger` = auto, tab, button, link |
| `dial_turn_pressed`, `dial_turned` | Turn tapped; landed (`gift`) |
| `dial_claimed` | Code issued (`gift`, `reminders`). Also fires Meta `Lead` |
| `dial_duplicate` | That phone already had a gift |
| `dial_hold_expired` | The 10 minutes ran out |
| `dial_address_added` | Optional address saved |
| `dial_call_clicked`, `dial_book_clicked` | Call or Book online from the popup |
| `dial_no_thanks`, `dial_closed` | Closed |

## Configuration

`data/dial.json` (push to deploy):
- `gifts`: odds (`weight`), dollar `value`, names. `zones` place them on the dial; keep each gift's zones summing to
  its weight, and run `npm test`.
- `membership.months`: which months have a free year. A month not listed has none.
- `expiresDays`, `holdMinutes`, `limits`, `zipPrefixes`, `phone`, `bookUrl`, `rulesFinal`.

Embed options (`window.__ARR_DIAL__`): `split` (0.5), `delayMs` (2000), `snoozeDays` (7), `excludePaths`, `tab`
(true), `debug` (false, logs events to the console), `apiBase` (only if dial.js is served from elsewhere).

## Operations

- **Find a code**: Monday (the code is in the item name), or Supabase `comfort_dial_entries` by `code` or `phone`.
- **Redeem**: CSR sets Code status → Redeemed (see CSR-GUIDE.md). The webhook fills `redeemed_at`. If the webhook is
  down, set `redeemed_at` by hand in Supabase.
- **If Monday was down** when someone won, the win is still in `comfort_dial_entries` with `monday_item_id` empty.
  Errors are logged as `dial win` in the Webflow Cloud logs.
- **Reopen a month's free year** (a test win, a refund): delete the entry, then set `claimed_at` to null on that
  month's row in `comfort_dial_memberships`.
- **Change gifts or odds**: edit `data/dial.json`, `npm test`, push. The dial, the odds panel and the rules page all
  redraw from it.

## Known limits

- The household rule for regular gifts is checked by the CSR at booking, not online: the claim asks only for a phone.
  A free year is tied to a county-matched home and is one per household in the database.
- ZIP check is by prefix (604, 605, 606), not the exact service-area list.
- Address autocomplete is not in the popup; only free-year winners and the optional step type an address.
- Codes aren't enforced in Sera (no API); the single-use rule is the CSR checking Code status.
- The Podium token is the pricing app's static token; if Podium expires it, texts stop (the win still shows on screen).
