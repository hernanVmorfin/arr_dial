/* One-line summaries of what we know about a winner, for the CSR: the Monday item's notes (lib/monday.ts) and the
 * admin's code view (src/admin/codes.js) both print these. Pure; every input may be missing. */

const n = (v) => Number(v).toLocaleString('en-US');
const lc = (s) => String(s || '').toLowerCase();
const monthYear = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', year: 'numeric' });
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' });

/** '1992 · 2-story frame/brick · 1,686 sq ft · warm air furnace · central air · full basement, unfinished' */
export function homeLine(h) {
  if (!h) return '';
  return [
    h.yearBuilt && `built ${h.yearBuilt}`,
    h.style ? lc(h.style) : h.stories && `${h.stories}-story`,
    h.sqft && `${n(h.sqft)} sq ft`,
    h.heating && h.heating !== 'None' ? lc(h.heating) : h.heating === 'None' ? 'no heating on record' : null,
    h.centralAir === true ? 'central air' : h.centralAir === false ? 'no central air' : null,
    h.basement && `${lc(h.basement)} basement${h.basementFinish ? `, ${lc(h.basementFinish)}` : ''}`,
    [h.municipality || h.township && `${h.township} Twp`, h.county && `${h.county} County`].filter(Boolean).join(', ') || null
  ].filter(Boolean).join(' · ');
}

/** What the record suggests talking about. Plain observations, not promises. */
export function homeHints(h, now = new Date()) {
  if (!h) return [];
  const out = [];
  if (h.centralAir === false) out.push('no central air on record: ask about AC');
  if (/steam|hot water/i.test(h.heating || '')) out.push('boiler (hot water/steam) heat');
  if (/electric/i.test(h.heating || '')) out.push('electric heat');
  if (h.yearBuilt && now.getFullYear() - h.yearBuilt >= 40) out.push(`${now.getFullYear() - h.yearBuilt}-year-old home`);
  return out;
}

const STATUS_WORD = { issued: 'usable', redeemed: 'redeemed', expired: 'expired', void: 'void' };

/** Which lookups ran: a source left unchecked (not set up, or it failed) isn't "nothing found". */
export function priorChecked(p) {
  if (!p) return [];
  return [p.leads !== undefined && 'Monday', p.klaviyo !== undefined && 'Klaviyo', p.atAddress !== undefined && 'other dial codes at the home'].filter(Boolean);
}

/** 'Instant Pricing lead Oct 2, 2026 (Maria, New) · Klaviyo since Mar 2025, maria@x.com · other dial codes here: ...' */
export function priorLine(p) {
  if (!p) return '';
  const parts = [];
  for (const l of (p.leads || []).slice(0, 3)) {
    parts.push(`Monday lead ${shortDate(l.created)}: ${l.name}${l.status ? ` (${l.status})` : ''}`);
  }
  if (p.klaviyo) {
    const k = p.klaviyo;
    parts.push(`Klaviyo profile since ${monthYear(k.since)}${k.email ? `, ${k.email}` : ''}${k.firstName || k.lastName ? `, ${[k.firstName, k.lastName].filter(Boolean).join(' ')}` : ''}`);
  }
  if (p.atAddress && p.atAddress.length) {
    parts.push(`other dial codes at this home: ${p.atAddress.map((x) => `${x.code} (${STATUS_WORD[x.status] || x.status})`).join(', ')}`);
  }
  return parts.join(' · ');
}

/** 'visit 3 since Oct 2 · from google.com, google/cpc · landed on /furnace-repair · 5 pages · mobile · near Orland Park 60462 (in area)' */
export function visitLine(c) {
  if (!c) return '';
  const src = (a) => (a && (a.utm_source || a.utm_medium) ? [a.utm_source, a.utm_medium].filter(Boolean).join('/') : '');
  const clicks = (a) => (a ? ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid', '_kx'].filter((k) => a[k]).map((k) => ({ gclid: 'Google ad', gbraid: 'Google ad', wbraid: 'Google ad', fbclid: 'Meta ad', msclkid: 'Bing ad', ttclid: 'TikTok ad', _kx: 'Klaviyo email/text' }[k])) : []);
  const fromParts = [c.referrer, src(c.ads), ...new Set(clicks(c.ads))].filter(Boolean);
  const from = fromParts.length ? fromParts.join(', ') : c.landing ? 'direct' : '';
  const first = c.visits > 1 && c.firstSeen ? `visit ${c.visits} since ${shortDate(c.firstSeen)}` : c.visits === 1 ? 'first visit' : '';
  const firstFrom = c.visits > 1 ? [c.firstReferrer, src(c.firstAds), ...new Set(clicks(c.firstAds))].filter(Boolean).join(', ') : '';
  const g = c.geo;
  return [
    first,
    firstFrom && `first came from ${firstFrom}`,
    from && `this visit from ${from}`,
    c.landing && `landed on ${c.landing}`,
    c.pageViews ? `${c.pageViews} page${c.pageViews === 1 ? '' : 's'}${c.pages && c.pages.length > 1 ? ` (${c.pages.slice(-5).join(', ')})` : ''}` : null,
    c.device,
    g && (g.city || g.zip) && `near ${[g.city, g.zip].filter(Boolean).join(' ')}${g.inArea === true ? ' (in area)' : g.inArea === false ? ' (outside our ZIPs)' : ''}`
  ].filter(Boolean).join(' · ');
}
