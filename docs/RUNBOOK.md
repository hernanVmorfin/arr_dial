# Comfort Dial runbook

Setup, launch, the 50/50 test, and operations. Nothing reaches visitors until step 7 (the Webflow embed).

## Launch checklist

In order. Each step is safe to stop after.

1. **Supabase**: SQL Editor in project `dienlkpgmgetkkdyduap` (the Instant Pricing project) → run
   `supabase/migrations/20261016_comfort_dial.sql`, then `20261019_comfort_dial_admin.sql` (the admin's tables and the
   results function), then `20261020_comfort_dial_context.sql` (visit, home and earlier-contact columns, and
   `comfort_dial_home`, which reads the pricing app's county tables), then `20261021_comfort_dial_oauth.sql` (where
   the Podium token is kept, so every isolate shares it). They only create `comfort_dial_*` objects.
   (The first three were applied on Oct 19, 2026 through the Supabase connector; the OAuth one is newer. Texts go
   out without it, but each isolate then refreshes the Podium token for itself.) If an empty `dial_entries`
   table exists from the earlier PR #10 migration, it can be dropped; nothing reads it.
   **First admin**: Authentication → Users → Add user → email + password, auto-confirm. Then in the SQL editor:
   `insert into public.comfort_dial_admins (email, name) values ('jason@arrhvac.com', 'Jason');`. Everyone after
   that is added from the admin's Team tab.
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
   | `PODIUM_CLIENT_ID`, `PODIUM_CLIENT_SECRET`, `PODIUM_REFRESH_TOKEN` | Podium's OAuth app and a refresh token (see [Podium sign-in](#podium-sign-in)). The Worker keeps the access token fresh itself |
   | `PODIUM_API_TOKEN` | Same as the pricing app. Used alone until the three above are set, then only if a refresh fails |
   | `PODIUM_LOCATION_UID` | Same as the pricing app |
   | `KLAVIYO_PRIVATE_KEY` | Klaviyo → Settings → API keys → private key with write access to Profiles, Events and Subscriptions |
   | `KLAVIYO_SMS_LIST_ID` | Optional: the list reminder opt-ins join |
   | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare → Turnstile → add widget for `alwaysreadyrepair.com` (Managed or Invisible) |

   `wrangler.json` keeps `"keep_vars": true` so deploys don't wipe these (the pricing app learned this the hard way).
4. **Check the deploy**: `https://www.alwaysreadyrepair.com/dial/api/health?deep=1`
   - `dial: true`, `integrations.supabase: "ok"`, and every integration you configured is `true`.
   - `integrations.podiumAuth.mode` should be `"oauth"`. `"static"` means the three OAuth keys aren't all set and
     texts depend on the pricing app's token (see [Podium sign-in](#podium-sign-in)).
   - **`yourIp` must be your own public IP.** If it shows the same address for everyone (a Webflow proxy), set
     `DIAL_IP_LIMITS=off`, or the per-IP limits will block real visitors.
   - `yourPlace` should be your city and ZIP. If it's `null`, Webflow Cloud isn't passing Cloudflare's location and
     the visit context will have no city or in-area flag (everything else still works).
   - `https://www.alwaysreadyrepair.com/dial/` should open the dial.
   - `https://www.alwaysreadyrepair.com/dial/admin` should ask you to sign in, and let the first admin in.
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
   <script type="module" src="/dial/dial.js"></script>
   ```

   Publish. The 50/50 test is now running at the split set in the admin (Settings → Visitors who get the popup,
   50% to start). Don't put `split` or the other popup settings in the embed: the admin's win anyway.
8. **Live test**: open `https://www.alwaysreadyrepair.com/?dial=1`, turn, claim with your own phone. Confirm the
   text, the Monday item and the Klaviyo event. Then run `ARRDial.reset()` in the browser console and delete your row
   in `comfort_dial_entries` (and its turn in `comfort_dial_turns`). Each test needs a different phone.
9. **Klaviyo flow**: build it from [KLAVIYO.md](KLAVIYO.md) once the first event has created the
   "Comfort Dial Won" metric, then set it live.
10. **GA4**: in GTM, add GA4 event tags for the `dial_*` events below, and a user property `dial_variant` from the
    data layer.
11. **Rules**: after the legal read, admin → Settings → **The rules are final** → publish. The draft banner on
    `/dial/rules` goes away.

**Rollback** at any point: remove the embed line and republish. The app and tables can stay; nothing calls them
without the embed. To pause without touching Webflow: admin → **Pause the dial**. The popup stops opening by itself,
no new turns are taken, and buttons show a call-us message. (Removing `SUPABASE_SECRET_KEY` still works as a last
resort, but it takes the admin down too.)

## The 50/50 test

The admin's split (Settings → Visitors who get the popup) puts each visitor in the `dial` or `control` group. Each
browser keeps a random number and is in `dial` while it is below the split, so changing the split only moves the
visitors in between (50% → 100% moves the whole control group into `dial`; nobody already in `dial` leaves). Control
never sees the popup open by itself or the side tab; `?dial=1` links and buttons still work for them, so ads can
point anywhere.

Every data-layer event carries `dial_variant`. Compare, per visitor, by group for 2 weeks: phone taps
(`dial_call_clicked` plus the site's own call tracking), Book Service visits, and booked jobs. If the dial group
books more, set the split to 100%. If it books less, set it to 0% (or remove the embed).

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

The admin (`/dial/admin`) edits and publishes everything visitors see: promos, odds, dial layout, popup settings,
limits, contact details, rules status. Each publish is a row in `comfort_dial_config`; the newest is live, and the
dial, the rules page and new turns pick it up within 15 seconds. History → Restore publishes an old one again.

`data/dial.json` is version 0, the config until the first publish and the fallback if Supabase can't be read.
Not in the admin yet: `membership.months`, which months have a free year. Every publish carries them over from the
version before, so after the first publish, changing them is a developer job (or a future Settings field).

Embed options (`window.__ARR_DIAL__`), all optional: `debug` (false, logs events to the console), `apiBase` (only if
dial.js is served from elsewhere), `logoUrl`. Popup settings set here (`split`, `delayMs`, ...) are overridden by the
admin's; `force: {...}` overrides the admin (the QA page at `/dial/` uses it).

## Operations

- **Find a code**: admin → Codes (code, phone, name or street), or Monday (the code is in the item name).
- **Redeem**: CSR sets Code status → Redeemed (see CSR-GUIDE.md). The webhook fills `redeemed_at`. If the webhook is
  down, admin → Codes → Mark redeemed (it also sets Monday's Code status).
- **Void, restore, extend, text again**: admin → Codes. Void sets Monday's Code status to `Void` (Monday adds the
  label the first time) and sends Klaviyo "Comfort Dial Voided", which stops the reminders once the flow filters on
  it (KLAVIYO.md). Extending updates Monday's notes; reminder texts already queued keep the old date. Resends are
  capped at 3 a day per code.
- **Who changed what**: History (configs) and each code's history (code actions); everything, including sign-ins,
  is in Supabase `comfort_dial_audit`.
- **Locked out**: 8 wrong passwords in 15 minutes pause sign-in for that email and that connection for 15 minutes.
  It clears itself.
- **Forgotten admin password**: reset it in Supabase → Authentication → Users. (Removing and re-adding someone in
  the Team tab keeps their old password, because the account already exists.)
- **If Monday was down** when someone won, the win is still in `comfort_dial_entries` with `monday_item_id` empty.
  Errors are logged as `dial win` in the Webflow Cloud logs.
- **Reopen a month's free year** (a test win, a refund): delete the entry, then set `claimed_at` to null on that
  month's row in `comfort_dial_memberships`.
- **Change gifts or odds**: admin → Promos & odds → Review & publish. The dial, the odds panel and the rules page all
  redraw from it. Turns already taken keep the odds they were played under (`comfort_dial_turns.config_version`).

## Podium sign-in

Podium's API is OAuth 2 ([docs](https://docs.podium.com/docs/oauth)). An access token lasts 10 hours; a refresh
token gets a new one from `https://api.podium.com/oauth/token`. The Worker does that by itself shortly before the
token runs out, and keeps the newest pair in Supabase `comfort_dial_oauth`, so every isolate uses the same one and a
refresh token Podium hands back isn't lost. If Podium refuses a token early (a 401), the Worker refreshes once and
sends again. A text that still fails never blocks the win; it shows in the Webflow Cloud logs as `dial win`
(`podium ...`), and admin → Codes → **Text it again** works once Podium is back.

**Getting the first refresh token** (once; again only if Podium revokes the app's access):

1. In [developer.podium.com](https://developer.podium.com), open ARR's app (or create one) and note its **Client ID**
   and **Client Secret**. Its redirect URI must be HTTPS and match exactly. Any page ARR controls will do (for example
   `https://www.alwaysreadyrepair.com/`), since you only need the `code` Podium adds to the address bar.
2. Signed in to Podium as an ARR admin, open:
   `https://api.podium.com/oauth/authorize?client_id=<CLIENT_ID>&redirect_uri=<REDIRECT_URI>&scope=write_messages%20read_locations&state=dial`
   and approve. Podium sends you to the redirect URI with `?code=...&state=dial`. Copy the code (it is short-lived).
3. Trade it for tokens:

   ```bash
   curl -s https://api.podium.com/oauth/token -H 'Content-Type: application/json' -d '{"client_id":"<CLIENT_ID>","client_secret":"<CLIENT_SECRET>","redirect_uri":"<REDIRECT_URI>","code":"<CODE>","grant_type":"authorization_code"}'
   ```

4. Set `PODIUM_CLIENT_ID`, `PODIUM_CLIENT_SECRET` and `PODIUM_REFRESH_TOKEN` (the `refresh_token` from step 3) in the
   Webflow Cloud app's environment. Keep `PODIUM_API_TOKEN` and `PODIUM_LOCATION_UID` as they are.
5. Check `/dial/api/health?deep=1`: `podiumAuth.mode` is `"oauth"`. After the next text (a win or **Text it again**),
   `podiumAuth.expiresAt` shows when the shared token runs out and `refreshedAt` when it was last refreshed.

**If the logs show `podium token 400` or `401`** (under `dial podium refresh failed` or `dial win`), the refresh token
is no longer accepted (revoked, or the app's access was removed). Texts then go out on `PODIUM_API_TOKEN` while it
lasts. Repeat the steps above and set the new `PODIUM_REFRESH_TOKEN`: the Worker tries the stored refresh token
first and falls back to the env one when Podium refuses it. To move to a different Podium account or app, also
delete the `podium` row in `comfort_dial_oauth`, or the stored token keeps being used until it expires. Otherwise
leave that row alone: if Podium rotates refresh tokens, the newest one is only there.

## Known limits

- The household rule for regular gifts is checked by the CSR at booking, not online: the claim asks only for a phone.
  A free year is tied to a county-matched home and is one per household in the database.
- ZIP check is by prefix (604, 605, 606), not the exact service-area list.
- Address autocomplete is not in the popup; only free-year winners and the optional step type an address.
- Codes aren't enforced in Sera (no API); the single-use rule is the CSR checking Code status.
- Until `PODIUM_CLIENT_ID`, `PODIUM_CLIENT_SECRET` and `PODIUM_REFRESH_TOKEN` are set, texts use the pricing app's
  static token and stop when Podium expires it (the win still shows on screen). See [Podium sign-in](#podium-sign-in).
- Two isolates whose tokens run out at the same moment can both refresh. The one Podium refuses picks up the other's
  pair from Supabase. Podium's docs don't say whether refresh tokens rotate, so this is handled both ways.
