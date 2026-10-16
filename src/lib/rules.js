/* Comfort Dial rules: pure functions shared by the API and its tests. No I/O here.
 * The data (gifts, odds, membership months, limits) is data/dial.json. */

const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';   // no 0/O, 1/I/L, 2/Z, 5/S, 8/B: codes get read aloud over the phone

const random = () => {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 2 ** 32; } catch { return Math.random(); }
};

/** 'YYYY-MM' for the given instant in Chicago, so the monthly free year flips at local midnight on the 1st. */
export function chicagoMonth(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).formatToParts(date);
  const y = p.find((x) => x.type === 'year').value, m = p.find((x) => x.type === 'month').value;
  return `${y}-${m}`;
}

/** 'November 15, 2026' in Chicago time: how expiry dates are shown to customers and CSRs. */
export function chicagoDate(date) {
  return new Date(date).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' });
}

export const inSeason = (cfg, month) => cfg.membership.months.includes(month);

/** The next listed membership month after `month`, or null. */
export function nextMembershipMonth(cfg, month) {
  return cfg.membership.months.filter((m) => m > month).sort()[0] || null;
}

/** How many free years are still to come this season, counting this month if it hasn't been claimed. */
export function membershipsLeft(cfg, month, claimedMonths) {
  const taken = new Set(claimedMonths);
  return cfg.membership.months.filter((m) => m >= month && !taken.has(m)).length;
}

/** The gifts in play right now. The free year drops out when this month has none to give. */
export function giftsInPlay(cfg, membershipAvailable) {
  return cfg.gifts.filter((g) => g.id !== cfg.membership.giftId || membershipAvailable);
}

/** Weighted pick. `rand` returns [0,1). The odds of what's left are renormalised, never redistributed by hand. */
export function pickGift(cfg, membershipAvailable, rand = random) {
  const pool = giftsInPlay(cfg, membershipAvailable);
  const total = pool.reduce((s, g) => s + g.weight, 0);
  let r = rand() * total;
  for (const g of pool) { if ((r -= g.weight) < 0) return g; }
  return pool[pool.length - 1];
}

/** The odds shown on the dial, as percentages of what is in play. */
export function oddsInPlay(cfg, membershipAvailable) {
  const pool = giftsInPlay(cfg, membershipAvailable);
  const total = pool.reduce((s, g) => s + g.weight, 0);
  return Object.fromEntries(cfg.gifts.map((g) => [g.id, pool.includes(g) ? (g.weight / total) * 100 : 0]));
}

export function makeCode(rand = random) {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return `ARR-${s}`;
}

export const isCode = (s) => /^ARR-[ACDEFGHJKMNPQRTUVWXY34679]{4}$/.test(String(s || ''));
export const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || ''));

/** US number to 10 digits, or null. Accepts (708) 555-0142, 708.555.0142, +1 708 555 0142. */
export function normPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? d : null;
}

export const fmtPhone = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;

/** A name-shaped first name or null. Whatever a visitor types can reach a text from ARR's number, so nothing else gets through. */
export function cleanFirstName(raw) {
  const first = String(raw || '').trim().split(/\s+/)[0] || '';
  return /^[A-Za-z][A-Za-z'-]{0,29}$/.test(first) ? first[0].toUpperCase() + first.slice(1) : null;
}

/** Street + ZIP for a free-year winner or the optional "book faster" step.
 *  @returns {{ ok: true, data: { street: string, zip: string } } | { ok: false, field: string, error: string }} */
export function validateAddress(body, cfg) {
  const b = body || {};
  const street = String(b.street || '').trim().replace(/\s+/g, ' ');
  const zip = String(b.zip || '').trim();
  if (!/^\d+[A-Za-z]?\s+\S+/.test(street) || street.length > 120) return { ok: false, field: 'street', error: 'Enter your street address with the house number.' };
  if (!/^\d{5}$/.test(zip)) return { ok: false, field: 'zip', error: 'Enter a 5-digit ZIP code.' };
  if (!cfg.zipPrefixes.some((p) => zip.startsWith(p))) return { ok: false, field: 'zip', error: 'That ZIP is outside our service area. We serve Chicago and the south and southwest suburbs.' };
  return { ok: true, data: { street, zip } };
}

/** Font size (SVG units) for a curved dial label: as large as `max`, shrunk to fit its arc. Oswald 600 averages
 *  about half an em per character, so `perChar` 0.52 leaves a little air at each end. */
export function labelFontSize(text, arcUnits, max, perChar = 0.52) {
  return Math.min(max, arcUnits / (String(text).length * perChar));
}
export const arcUnits = (pct, radius) => (pct / 100) * 270 * Math.PI / 180 * radius;

export const expiresAt =(from, days) => new Date(from.getTime() + days * 864e5);
export const holdUntil = (from, minutes) => new Date(from.getTime() + minutes * 6e4);
export const dayAgo = (now) => new Date(now.getTime() - 864e5);
