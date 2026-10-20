# ARR Comfort Dial

The gift popup for alwaysreadyrepair.com: a round wall thermostat a visitor turns to win a real gift from
Always Ready Repair. Turn first, claim second. One tap turns the dial; a mobile number claims the gift; the code is
texted, lands on the Monday leads board, and starts a Klaviyo reminder flow.

A Webflow Cloud app (Astro on Cloudflare Workers) mounted at `alwaysreadyrepair.com/dial`. It serves:

| Path | What |
|---|---|
| `/dial/dial.js` | The popup. One script tag in Webflow site-wide custom code. |
| `/dial/api/status` · `turn` · `claim` · `details` | The popup's API. The server picks every gift. |
| `/dial/api/weather` | Outside weather where the visitor is (Cloudflare's IP estimate, no prompt; National Weather Service). |
| `/dial/api/redeemed` | Monday webhook: Code status set to Redeemed. |
| `/dial/api/health` | Build and integration check (`?deep=1` also reads Supabase). |
| `/dial/rules` | Official rules, generated from the live config. |
| `/dial/admin` | The admin: promos and odds, settings, codes, results, history, team. Email + password sign-in. |
| `/dial/api/admin/*` | The admin's API (signed-in admins only). |
| `/dial/` | A page that opens the dial (QA, staging, direct link). |

## How it works

1. **Opens** after 4 s on the site (on screen, counted across pages), for every visitor (the admin can lower that to
   run a split test), on any page except Instant Pricing, Book Service, Contact, Financing and pay pages. Never over
   the pricing popup, never after a win, not again for 7 days. `?dial=1` and `[data-arr-dial="open"]` buttons always
   open it.
2. **Turn**: `/api/turn` picks a gift by the published odds and holds it for 10 minutes. The free year ($299
   membership, one per month) is held for that turn alone, so the countdown is real.
3. **Claim**: a mobile number. A free-year winner also gives a home address, which must match a county record.
   One gift per phone (database constraint); one per household is checked by the CSR at booking.
4. **After the win** (in the background): the code is texted at once (Podium). Then the dial looks up what it can
   (below), and the Monday item and Klaviyo's "Comfort Dial Won" event go out with it.
5. **Redeemed**: the CSR sets Code status to Redeemed on the Monday item; the webhook marks the code used and tells
   Klaviyo, which stops the reminders.

Gifts, odds, limits and the popup's settings are a **config** edited and published in the admin. Every publish is a
new version in Supabase (`comfort_dial_config`), and each turn records the version that picked its gift.
`data/dial.json` is version 0: what runs until someone publishes, and the fallback if Supabase can't be read. Each
gift's weight is both its odds and its arc on the dial; the admin lays the dial out from the odds and refuses to
publish a config that breaks the rules in `validateConfig` (`src/lib/rules.js`).

## What we know beyond the form

Nothing here is shown to the visitor; it is for the CSR (Monday item notes, the admin's code view) and Klaviyo.

| | When | What |
|---|---|---|
| Visit | Every turn | First visit and this one: landing page, outside referrer, utm tags and ad click ids (Google, Meta, Microsoft, TikTok, Klaviyo), pages viewed, visits so far, time on site, device. GA client id and Meta browser ids. City and ZIP from the IP (Cloudflare) and whether that ZIP is one ARR serves (`service_area_zips`). Paths only: query strings are dropped except utm tags and click ids. |
| Home | When they give an address (free year at the claim, anyone in "book faster") | The county record from the pricing app's tables: year built, size, stories, style, heating (furnace or boiler), central air, basement. Suggests what to ask about ("no central air on record"). |
| Seen before | After the claim | Earlier items with their phone on the Monday leads board (Instant Pricing quotes), their Klaviyo profile, other dial codes at the same home. |

Klaviyo gets the home and visit as event properties (`home_*`, `visit_*`) and profile properties (`arr_*`); someone who
arrived from a Klaviyo email or text is joined to their existing profile (`_kx`). The code itself never waits on any
of it: the text goes out first, and a lookup that fails is noted and skipped.

## The admin

`/dial/admin`, for whoever is on the `comfort_dial_admins` list. Passwords are Supabase Auth's (same project), so
this app never stores one.

| Tab | What it does |
|---|---|
| Promos & odds | Each promo's name, value, dial label, colours and odds, with the dial drawn live as visitors will see it. Add a promo, switch one off, reorder the slices. Published promos can be switched off, never deleted, so their codes keep working. |
| Settings | The popup's share of visitors (100%, or less for a split test), delay, snooze, side tab, pages where it never opens; hold time, code expiry, daily limits; phone, booking link, service-area ZIPs; rules draft/final. |
| Codes | Find a code by code, phone, name or street. Mark redeemed, void (with a reason), restore, extend, text it again. Export CSV. Every action is logged with who did it. |
| Results | Turns, people, codes claimed, redemptions, value, opt-ins; by day; each promo's real share of turns against its odds; sources. |
| History | Every published version, what changed and who published it. Restore any of them. |
| Team | Add an admin (with a temporary password), remove one, see last sign-ins. |

**Pause the dial** (above the tabs) stops it at once: no auto-open, no new turns, the button shows a call-us message.
Edits in Promos and Settings are a draft until **Review & publish**; the site picks up a publish within 15 seconds.
Two admins editing at once can't overwrite each other: the second publish is refused and asked to reload.

## Develop

```bash
npm install
cp .env.example .env        # MOUNT_PATH=/dial
npm run dev                 # http://localhost:4321/dial/
```

With no Supabase keys, `astro dev` keeps turns, wins and published configs in memory, so the whole flow can be
clicked through. Runtime keys for local testing go in `.dev.vars` (same names as `.env.example`). The sample home
`14532 S Ravinia Ave, 60462` passes the county-record check locally. The local admin is at
http://localhost:4321/dial/admin, signed in with the local-only account in `DEV_ADMIN` (`src/lib/runtime.ts`); it
doesn't exist in a production build. A dev-server restart forgets everything, including the session.

```bash
npm test                    # rules, service logic and admin (in-memory store), integration payloads
npm run check               # astro check
npm run deploy:check        # astro build + wrangler dry run: what Webflow Cloud runs
```

Launch and operations: [docs/RUNBOOK.md](docs/RUNBOOK.md). CSRs: [docs/CSR-GUIDE.md](docs/CSR-GUIDE.md).
Klaviyo reminders: [docs/KLAVIYO.md](docs/KLAVIYO.md).
