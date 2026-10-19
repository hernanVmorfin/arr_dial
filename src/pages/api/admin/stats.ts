import type { APIRoute } from 'astro';
import { configFor, dbFor, envOf } from '../../../lib/runtime.ts';
import { statsRange } from '../../../lib/admin/service.ts';
import { oddsInPlay } from '../../../lib/rules.js';
import { adminJson } from '../../../lib/admin/http.ts';

/* GET /api/admin/stats?range=today|7d|30d|all  or  ?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   → { from, to, stats, gifts }. gifts carries each gift's name, value, colour and its odds now (with and without the
 *   free year in play), so the page can set the actual share of turns beside the odds. */
export const GET: APIRoute = async ({ locals, url }) => {
  const db = dbFor(envOf(locals))!;
  const p = url.searchParams;
  const r = statsRange({ range: p.get('range'), from: p.get('from'), to: p.get('to') });
  try {
    const [stats, cfg] = await Promise.all([db.stats(r.since, r.until), configFor(db)]);
    const withMem = oddsInPlay(cfg, true), without = oddsInPlay(cfg, false);
    const gifts = cfg.gifts.map((g) => ({ id: g.id, name: g.name, short: g.short, value: g.value, fill: g.fill, active: g.active !== false, odds: withMem[g.id], oddsNoFreeYear: without[g.id] }));
    return adminJson({ from: r.from, to: r.to, stats, gifts, version: cfg.version ?? 0, membershipGiftId: cfg.membership.giftId });
  } catch (e) {
    console.error('dial admin stats', e);
    return adminJson({ error: 'Couldn\'t load the results.' }, 502);
  }
};
