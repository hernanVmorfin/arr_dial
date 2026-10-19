/* The visit behind a turn: where they came from, what they looked at, and which ad or email brought them. The popup
 * (src/widget/index.js) records it as they browse and sends it with the turn; the server cleans it (cleanContext)
 * and adds the rough place from their IP (geoFrom). Pure functions, shared by both sides and the tests.
 *
 * Only paths are kept, never query strings, except the utm_* tags and ad click ids: a URL can carry an email or a
 * name, and the dial doesn't want either by accident. Nothing here is shown back to the visitor. */

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
/* Google (gclid, gbraid, wbraid), Meta (fbclid), Microsoft (msclkid), TikTok (ttclid), Klaviyo email/SMS (_kx). */
export const CLICK_KEYS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid', '_kx'];

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const int = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : undefined);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)));

/** The utm_* tags and click ids in a query string, or null. */
export function adParams(search) {
  const out = {};
  try {
    const q = new URLSearchParams(search || '');
    for (const k of [...UTM_KEYS, ...CLICK_KEYS]) { const v = str(q.get(k), 160); if (v) out[k] = v; }
  } catch (e) { /* not a query string */ }
  return Object.keys(out).length ? out : null;
}

/** '/furnace-repair' from any URL or path; no query, no hash. */
export function pathOf(url) {
  try { return new URL(url, 'https://x.invalid').pathname.slice(0, 120) || '/'; } catch (e) { return undefined; }
}

/** An outside referrer as 'host/path' ('google.com/', 'facebook.com/'); null for our own site or none. */
export function referrerOf(ref, ownHost) {
  if (!ref) return null;
  try {
    const u = new URL(ref);
    const host = u.hostname.replace(/^www\./, '');
    if (ownHost && host === String(ownHost).replace(/^www\./, '')) return null;
    return `${host}${u.pathname}`.slice(0, 160);
  } catch (e) { return null; }
}

export function cookieOf(cookies, name) {
  for (const part of String(cookies || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) { try { return decodeURIComponent(part.slice(i + 1)); } catch (e) { return part.slice(i + 1); } }
  }
  return null;
}

/** GA4's client id from the _ga cookie: 'GA1.1.123456789.1700000000' → '123456789.1700000000'. */
export function gaClientId(cookies) {
  const m = /^GA\d\.\d\.(\d+\.\d+)$/.exec(cookieOf(cookies, '_ga') || '');
  return m ? m[1] : null;
}

/** Klaviyo's exchange id for someone who arrived from a Klaviyo email or text: the __kla_id cookie is base64 JSON
 *  that klaviyo.js fills with $exchange_id once it has identified them. */
export function klaviyoExchangeId(cookies) {
  const raw = cookieOf(cookies, '__kla_id');
  if (!raw) return null;
  try {
    const j = JSON.parse(atob(raw));
    return str(j && j.$exchange_id, 160) || null;
  } catch (e) { return null; }
}

export function deviceKind(width, touch) {
  if (width < 768) return 'mobile';
  if (width < 1100 && touch) return 'tablet';
  return 'desktop';
}

/** What the server keeps of what the browser sent: known keys only, lengths and counts capped. */
export function cleanContext(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ads = (o) => {
    if (!o || typeof o !== 'object') return undefined;
    const out = {};
    for (const k of [...UTM_KEYS, ...CLICK_KEYS]) { const v = str(o[k], 160); if (v) out[k] = v; }
    return Object.keys(out).length ? out : undefined;
  };
  const ids = r.ids && typeof r.ids === 'object' ? clean({
    ga: str(r.ids.ga, 60), fbp: str(r.ids.fbp, 120), fbc: str(r.ids.fbc, 200), kx: str(r.ids.kx, 160)
  }) : undefined;
  const ctx = clean({
    firstSeen: typeof r.firstSeen === 'string' && !isNaN(Date.parse(r.firstSeen)) ? new Date(r.firstSeen).toISOString() : undefined,
    visits: int(r.visits, 1, 10000),
    firstLanding: str(r.firstLanding, 120),
    firstReferrer: str(r.firstReferrer, 160),
    firstAds: ads(r.firstAds),
    landing: str(r.landing, 120),
    referrer: str(r.referrer, 160),
    ads: ads(r.ads),
    pages: Array.isArray(r.pages) ? r.pages.filter((p) => typeof p === 'string').slice(-15).map((p) => p.slice(0, 120)) : undefined,
    pageViews: int(r.pageViews, 0, 10000),
    page: str(r.page, 120),
    secondsOnSite: int(r.secondsOnSite, 0, 7 * 86400),
    device: ['mobile', 'tablet', 'desktop'].includes(r.device) ? r.device : undefined,
    screen: typeof r.screen === 'string' && /^\d{2,5}x\d{2,5}$/.test(r.screen) ? r.screen : undefined,
    lang: str(r.lang, 20),
    tz: str(r.tz, 60),
    ids
  });
  return Object.keys(ctx).length ? ctx : null;
}

/** The rough place behind their IP, from Cloudflare (request.cf), and whether it's a ZIP ARR serves. City-level:
 *  coordinates rounded to 2 decimals (about a kilometre). */
export function geoFrom(cf, serviceZips) {
  if (!cf || typeof cf !== 'object') return null;
  const zip = typeof cf.postalCode === 'string' && /^\d{5}$/.test(cf.postalCode) ? cf.postalCode : undefined;
  const r2 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : undefined);
  const g = clean({
    city: str(cf.city, 60), zip, region: str(cf.regionCode || cf.region, 40), country: str(cf.country, 4),
    lat: r2(cf.latitude), lon: r2(cf.longitude), isp: str(cf.asOrganization, 80),
    inArea: zip && serviceZips && serviceZips.length ? serviceZips.some((z) => z.zip === zip) : undefined
  });
  return Object.keys(g).length ? g : null;
}
