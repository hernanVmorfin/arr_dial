# ARR Comfort Dial

The gift popup for alwaysreadyrepair.com: a round wall thermostat a visitor turns to win a real gift from
Always Ready Repair. Turn first, claim second. One tap turns the dial; a mobile number claims the gift; the code is
texted, lands on the Monday leads board, and starts a Klaviyo reminder flow.

A Webflow Cloud app (Astro on Cloudflare Workers) mounted at `alwaysreadyrepair.com/dial`. It serves:

| Path | What |
|---|---|
| `/dial/dial.js` | The popup. One script tag in Webflow site-wide custom code. |
| `/dial/api/status` · `turn` · `claim` · `details` | The popup's API. The server picks every gift. |
| `/dial/api/redeemed` | Monday webhook: Code status set to Redeemed. |
| `/dial/api/health` | Build and integration check (`?deep=1` also reads Supabase). |
| `/dial/rules` | Official rules, generated from `data/dial.json`. |
| `/dial/` | A page that opens the dial (QA, staging, direct link). |

## How it works

1. **Opens** about 2 s after the page shows on a first visit, for visitors in the dial half of the 50/50 test, on any
   page except Instant Pricing, Book Service, Contact, Financing and pay pages. Never over the pricing popup, never
   after a win, not again for 7 days. `?dial=1` and `[data-arr-dial="open"]` buttons always open it.
2. **Turn**: `/api/turn` picks a gift by the published odds and holds it for 10 minutes. The free year ($299
   membership, one per month) is held for that turn alone, so the countdown is real.
3. **Claim**: a mobile number. A free-year winner also gives a home address, which must match a county record.
   One gift per phone (database constraint); one per household is checked by the CSR at booking.
4. **After the win** (in the background): Monday item, Podium text with the code, Klaviyo "Comfort Dial Won" event.
5. **Redeemed**: the CSR sets Code status to Redeemed on the Monday item; the webhook marks the code used and tells
   Klaviyo, which stops the reminders.

Gifts, odds, dates and limits live in `data/dial.json`. Each gift's weight is both its odds and its arc on the dial;
`npm test` fails if they disagree.

## Develop

```bash
npm install
cp .env.example .env        # MOUNT_PATH=/dial
npm run dev                 # http://localhost:4321/dial/
```

With no Supabase keys, `astro dev` keeps turns and wins in memory, so the whole flow can be clicked through. Runtime
keys for local testing go in `.dev.vars` (same names as `.env.example`). The sample home `14532 S Ravinia Ave, 60462`
passes the county-record check locally.

```bash
npm test                    # rules, service logic (in-memory store), integration payloads
npm run check               # astro check
npm run deploy:check        # astro build + wrangler dry run: what Webflow Cloud runs
```

Launch and operations: [docs/RUNBOOK.md](docs/RUNBOOK.md). CSRs: [docs/CSR-GUIDE.md](docs/CSR-GUIDE.md).
Klaviyo reminders: [docs/KLAVIYO.md](docs/KLAVIYO.md).
