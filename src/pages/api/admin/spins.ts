import type { APIRoute } from 'astro';
import { configFor, dbFor, envOf } from '../../../lib/runtime.ts';
import type { TurnOutcome } from '../../../lib/db.ts';
import { adminJson } from '../../../lib/admin/http.ts';
import { csvResponse, toCsv, when } from '../../../lib/admin/csv.ts';
import { spins } from '../../../lib/admin/service.ts';
import type { SpinView } from '../../../lib/admin/view.ts';

/* GET /api/admin/spins?outcome=&gift=&device=&page= → { rows, total, page, pageSize, all, claimed }
 *     Every turn of the dial, claimed or not, newest first. all/claimed count every turn ever, whatever the filter.
 * GET /api/admin/spins?format=csv&… → the same filter as a CSV download (up to 5,000 spins). */
const PAGE = 50, CSV_MAX = 5000;
const OUTCOMES: TurnOutcome[] = ['claimed', 'holding', 'unclaimed'];

export const GET: APIRoute = async ({ locals, url }) => {
  const db = dbFor(envOf(locals))!;
  const p = url.searchParams;
  const outcome = OUTCOMES.includes(p.get('outcome') as TurnOutcome) ? (p.get('outcome') as TurnOutcome) : undefined;
  const gift = /^[a-z0-9_]{2,24}$/.test(p.get('gift') || '') ? p.get('gift')! : undefined;
  const device = /^[\w-]{8,64}$/.test(p.get('device') || '') ? p.get('device')! : undefined;
  const now = new Date();
  try {
    const cfg = await configFor(db);
    if (p.get('format') === 'csv') {
      const rows: SpinView[] = [];
      for (let offset = 0; offset < CSV_MAX; offset += 1000) {
        const r = await spins(db, cfg, { outcome, gift, device, limit: 1000, offset, now });
        rows.push(...r.rows);
        if (r.rows.length < 1000) break;
      }
      return csvResponse(spinsCsv(rows), 'comfort-dial-spins', now);
    }
    const page = Math.max(1, Math.min(1000, Number(p.get('page')) || 1));
    const [r, all, claimed] = await Promise.all([
      spins(db, cfg, { outcome, gift, device, limit: PAGE, offset: (page - 1) * PAGE, now }),
      db.searchTurns({ limit: 0, offset: 0, now }),
      db.searchTurns({ outcome: 'claimed', limit: 0, offset: 0, now })
    ]);
    return adminJson({ ...r, page, pageSize: PAGE, all: all.total, claimed: claimed.total });
  } catch (e) {
    console.error('dial admin spins', e);
    return adminJson({ error: 'Couldn\'t load the spins.' }, 502);
  }
};

const OUTCOME_WORDS: Record<TurnOutcome, string> = { claimed: 'Claimed', holding: 'Holding now', unclaimed: 'Didn\'t claim' };
type Ads = Record<string, string> | undefined;
const source = (ads: Ads, ref: unknown) => [ref, ads && [ads.utm_source, ads.utm_medium].filter(Boolean).join('/')].filter(Boolean).join(', ');
const clicks = (ads: Ads) => (ads ? ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid', '_kx'].filter((k) => ads[k]).join(' ') : '');

function spinsCsv(rows: SpinView[]) {
  const head = ['Spun (Chicago)', 'Promo', 'Value', 'Outcome', 'Code', 'Phone', 'First name', 'Device', 'Spins from this device', 'Device id',
    'Visit #', 'First seen', 'First came from', 'This visit from', 'Landed on', 'Spun on page', 'Pages viewed', 'Pages', 'Seconds on site',
    'Campaign', 'Ad clicks', 'GA client id', 'Meta fbp', 'Meta fbc', 'City', 'ZIP', 'IP'];
  return toCsv(head, rows.map((s) => {
    const c = (s.context || {}) as Record<string, any>;
    const ads = c.ads as Ads, ids = (c.ids || {}) as Record<string, string>, geo = (c.geo || {}) as Record<string, string>;
    return [
      when(s.created_at), s.giftName, s.giftValue, OUTCOME_WORDS[s.outcome], s.code, s.phone, s.first_name, c.device, s.deviceTurns, s.device,
      c.visits, when(c.firstSeen), source(c.firstAds, c.firstReferrer), source(ads, c.referrer) || (c.landing ? 'direct' : ''), c.landing, c.page,
      c.pageViews, Array.isArray(c.pages) ? c.pages.join(' ') : '', c.secondsOnSite,
      ads?.utm_campaign, clicks(ads), ids.ga, ids.fbp, ids.fbc, geo.city, geo.zip, s.ip
    ];
  }));
}
