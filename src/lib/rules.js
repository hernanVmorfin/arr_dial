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

/** 'YYYY-MM-DD' for the given instant in Chicago: the day a turn or a claim counts toward in the admin's results.
 *  @param {Date | string | number} [date] */
export function chicagoDay(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date));
  const v = (t) => p.find((x) => x.type === t).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/** 'YYYY-MM-DD' moved by whole days (calendar arithmetic, no time zone involved). */
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The instant a Chicago calendar day starts (CST or CDT, whichever is in force that night). */
export function chicagoMidnight(day) {
  const [y, m, d] = day.split('-').map(Number);
  const hour = (t) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(t));
  for (const off of [5, 6]) {
    const t = new Date(Date.UTC(y, m - 1, d, off));
    if (chicagoDay(t) === day && hour(t) === 0) return t;
  }
  return new Date(Date.UTC(y, m - 1, d, 6));
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

/** 'October 2026' for '2026-10' (or 'October' with year: false). */
export function monthName(ym, { year = true } = {}) {
  const [y, m] = String(ym).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'long', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

/** What /api/status says about the free year in `month`, given the months already claimed. freeYear: the free-year
 *  gift is on the dial at all; inSeason: this month is on the schedule. */
export function freeYearStatus(cfg, month, claimedMonths) {
  const on = membershipActive(cfg);
  return {
    month,
    freeYear: on,
    inSeason: on && inSeason(cfg, month),
    membershipOpen: on && inSeason(cfg, month) && !claimedMonths.includes(month),
    membershipsLeft: on ? membershipsLeft(cfg, month, claimedMonths) : 0,
    membershipsTotal: cfg.membership.months.length,
    nextUnlock: on ? nextMembershipMonth(cfg, month) : null
  };
}

/** The line under the dial, from freeYearStatus (the popup's /api/status, or the admin's preview of a draft). Empty
 *  when the free year is off the dial or the status couldn't be read. */
export function scarcityLine(st) {
  if (!st || st.freeYear === false) return '';
  const name = (ym) => monthName(ym, { year: false });
  if (st.membershipsLeft === 0) return 'This season\'s free years are all claimed';
  if (st.membershipOpen) return `${name(st.month)}'s free year is still up for grabs`;
  if (st.nextUnlock && st.inSeason === false) return `${name(st.nextUnlock)}'s free year unlocks ${name(st.nextUnlock).slice(0, 3)} 1`;
  if (st.nextUnlock) return `${name(st.month)}'s free year is taken. Next one: ${name(st.nextUnlock).slice(0, 3)} 1`;
  return '';
}

/** Gifts on the dial. A switched-off gift (active: false) stays in the config so codes already issued for it still
 *  resolve, but it has no odds and no arc. */
export const activeGifts = (cfg) => cfg.gifts.filter((g) => g.active !== false);
export const membershipActive = (cfg) => activeGifts(cfg).some((g) => g.id === cfg.membership.giftId);

/** The gifts in play right now. The free year drops out when this month has none to give. */
export function giftsInPlay(cfg, membershipAvailable) {
  return activeGifts(cfg).filter((g) => g.id !== cfg.membership.giftId || membershipAvailable);
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

/* The gift ring on the thermostat screen, in SVG units of its 400-wide face. src/widget/face.js draws with these, in
 * the popup and the admin's preview alike. The top prize's slice is pushed outward by `raise`: deeper, never wider,
 * because a slice's angle is its odds. */
export const RING = { inner: 88, outer: 130, raise: 16 };
/** Where the two label lines of a slice sit, given that slice's outer radius. */
export const labelRadii = (outer) => ({ big: RING.inner + (outer - RING.inner) * 0.66, small: RING.inner + (outer - RING.inner) * 0.27 });

/* Label sizes on the dial face: radius on a plain slice (the raised top prize gets more room), the largest font size
 * for each line, and the minimum below which a label is hard to read on a phone. */
const PLAIN = labelRadii(RING.outer);
export const LABEL = { big: { radius: PLAIN.big, max: 17, min: 13 }, small: { radius: PLAIN.small, max: 8.6, min: 7.5 } };

const round2 = (n) => Math.round(n * 100) / 100;
const near = (a, b) => Math.abs(a - b) < 0.005;

/** The dial layout for a set of gifts: every active gift gets arcs adding up to its weight. Keeps the order of
 *  `zones` and how a gift is split across them, scaled to its new weight; drops gifts that are off; a gift with no
 *  zone yet goes on the HEAT end as one zone. Labels come from the gift's `big`/`small` when set, else its zone. */
export function layoutZones(zones, gifts) {
  const on = Object.fromEntries(gifts.filter((g) => g.active !== false && g.weight > 0).map((g) => [g.id, g]));
  const out = zones.filter((z) => on[z.gift]).map((z) => ({ gift: z.gift, pct: z.pct, big: z.big, small: z.small }));
  for (const id of Object.keys(on)) if (!out.some((z) => z.gift === id)) out.push({ gift: id, pct: on[id].weight, big: '', small: '' });
  for (const g of Object.values(on)) {
    const mine = out.filter((z) => z.gift === g.id);
    const was = mine.reduce((s, z) => s + (z.pct > 0 ? z.pct : 0), 0);
    let left = g.weight;
    mine.forEach((z, i) => {
      const pct = i === mine.length - 1 ? left : round2(was > 0 ? (Math.max(z.pct, 0) * g.weight) / was : g.weight / mine.length);
      z.pct = round2(pct); left = round2(left - z.pct);
      if (g.big != null) z.big = g.big;
      if (g.small != null) z.small = g.small;
    });
  }
  return out.filter((z) => z.pct > 0);
}

const HEX = /^#[0-9a-f]{6}$/i;
function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Everything a config must satisfy before it goes live. `prev` is the version it replaces: a gift that was ever
 *  published can be switched off but never removed, because codes already issued point at it. `ctx` adds what only
 *  the database knows, for the free-year schedule: this Chicago month (a month that has ended can't be added) and
 *  the months whose free year was won (they stay listed, because the official rules print them).
 *  @param {any} cfg  @param {any} [prev]  @param {{ month?: string, claimed?: string[] }} [ctx]
 *  @returns {{ errors: string[], warnings: string[] }} */
export function validateConfig(cfg, prev = null, ctx = {}) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const str = (v, lo, hi) => typeof v === 'string' && v.trim().length >= lo && v.length <= hi;
  if (!cfg || typeof cfg !== 'object') return { errors: ['The config is empty.'], warnings };

  if (typeof cfg.enabled !== 'boolean') err('Dial on/off is missing.');
  if (typeof cfg.rulesFinal !== 'boolean') err('Rules status (draft or final) is missing.');
  if (!str(cfg.season, 1, 40)) err('Season name: 1 to 40 characters.');
  if (!/^\(\d{3}\) \d{3}-\d{4}$/.test(String(cfg.phone || ''))) err('Phone must look like (708) 671-0813.');
  try { if (new URL(cfg.bookUrl).protocol !== 'https:') throw 0; } catch { err('Book online link must be a full https:// address.'); }
  if (!int(cfg.expiresDays, 1, 365)) err('Codes expire after: 1 to 365 days.');
  if (!int(cfg.holdMinutes, 1, 60)) err('Hold time: 1 to 60 minutes.');
  if (!Array.isArray(cfg.zipPrefixes) || !cfg.zipPrefixes.length || cfg.zipPrefixes.some((z) => !/^\d{3}$/.test(z))) err('Service area: at least one 3-digit ZIP prefix, like 604.');
  const L = cfg.limits || {};
  if (!int(L.turnsPerDevicePerDay, 1, 100)) err('Turns per device per day: 1 to 100.');
  if (!int(L.turnsPerIpPerDay, 1, 1000)) err('Turns per connection per day: 1 to 1000.');
  if (!int(L.claimsPerIpPerDay, 1, 1000)) err('Claims per connection per day: 1 to 1000.');
  const P = cfg.popup || {};
  if (typeof P.split !== 'number' || !(P.split >= 0 && P.split <= 1)) err('Share of visitors who get the popup: 0% to 100%.');
  if (!int(P.delayMs, 0, 60000)) err('Popup delay: 0 to 60 seconds.');
  if (!int(P.snoozeDays, 0, 90)) err('Snooze after it was seen: 0 to 90 days.');
  if (!Array.isArray(P.excludePaths) || P.excludePaths.length > 40 || P.excludePaths.some((p) => !/^\/[\w\-./]{0,120}$/.test(p))) err('Pages without the popup: paths that start with /, like /book-service.');
  if (typeof P.tab !== 'boolean') err('Side tab on/off is missing.');

  const gifts = Array.isArray(cfg.gifts) ? cfg.gifts : [];
  const M = cfg.membership || {};
  if (!gifts.length || gifts.length > 16) err('There must be 1 to 16 gifts.');
  const ids = new Set();
  for (const g of gifts) {
    const who = g && str(g.name, 1, 80) ? g.name : `Gift ${g && g.id}`;
    if (!g || !/^[a-z0-9_]{2,24}$/.test(String(g.id))) { err(`${who}: id must be 2 to 24 lowercase letters, digits or _.`); continue; }
    if (ids.has(g.id)) err(`Two gifts share the id ${g.id}.`);
    ids.add(g.id);
    if (!str(g.name, 1, 60)) err(`${who}: name, 1 to 60 characters.`);
    if (!str(g.sub, 1, 140)) err(`${who}: description, 1 to 140 characters.`);
    if (!str(g.short, 1, 22)) err(`${who}: short name (shown in the dial's centre), 1 to 22 characters.`);
    if (!int(g.value, 0, 10000)) err(`${who}: value, a whole dollar amount up to $10,000.`);
    if (typeof g.weight !== 'number' || !(g.weight >= 0 && g.weight <= 100) || !near(g.weight, round2(g.weight))) err(`${who}: odds between 0% and 100%, at most 2 decimals.`);
    if (g.active !== undefined && typeof g.active !== 'boolean') err(`${who}: on/off must be true or false.`);
    if (g.active !== false && !(g.weight > 0)) err(`${who}: a gift that is on needs odds above 0%. Switch it off instead.`);
    if (!HEX.test(String(g.fill)) || !HEX.test(String(g.ink))) err(`${who}: colours must be hex, like #084e91.`);
    else if (g.active !== false && contrast(g.fill, g.ink) < 3) warn(`${who}: the label colour is hard to read on its slice (contrast ${contrast(g.fill, g.ink).toFixed(1)}:1).`);
  }
  if (!ids.has(M.giftId)) err('The free-year gift is missing.');
  if (!Array.isArray(M.months) || M.months.some((m) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) || new Set(M.months).size !== M.months.length) err('Free-year months must be distinct YYYY-MM values.');
  else if (!M.months.length) err('Free-year months: pick at least one. The rules page dates the dial by them. To stop giving free years, switch the free year off in Promos & odds.');
  else if (M.months.some((m, i) => i && m < M.months[i - 1])) err('Free-year months must be in calendar order.');
  const prevMonths = Array.isArray(prev?.membership?.months) ? prev.membership.months : null;
  if (prevMonths && Array.isArray(M.months)) {
    for (const m of prevMonths) if (ctx.claimed?.includes(m) && !M.months.includes(m)) err(`Free-year months: ${monthName(m)}'s free year was won, so it stays on the schedule and in the official rules.`);
    for (const m of M.months) if (ctx.month && m < ctx.month && !prevMonths.includes(m)) err(`Free-year months: ${monthName(m)} has ended, so it can't be added.`);
  }
  if (prev && Array.isArray(prev.gifts)) for (const g of prev.gifts) if (!ids.has(g.id)) err(`${g.name} was published before, so codes may point at it. Switch it off instead of deleting it.`);

  const on = gifts.filter((g) => g && g.active !== false);
  if (!on.some((g) => g.id !== M.giftId)) err('At least one gift besides the free year must be on.');
  const total = on.reduce((s, g) => s + (Number(g.weight) || 0), 0);
  if (!near(total, 100)) err(`The odds of the gifts that are on add up to ${round2(total)}%. They must add up to 100%.`);

  const zones = Array.isArray(cfg.zones) ? cfg.zones : [];
  const onIds = new Set(on.map((g) => g.id));
  for (const z of zones) {
    if (!onIds.has(z.gift)) { err(`The dial has a slice for ${z.gift}, which is not an active gift.`); continue; }
    if (!(z.pct > 0)) err(`A slice for ${z.gift} has no width.`);
    if (!str(z.big, 1, 12)) err(`${z.gift}: big dial label, 1 to 12 characters.`);
    if (!str(z.small, 1, 18)) err(`${z.gift}: small dial label, 1 to 18 characters.`);
  }
  for (const g of on) {
    const arc = zones.filter((z) => z.gift === g.id).reduce((s, z) => s + z.pct, 0);
    if (!near(arc, g.weight)) err(`${g.name}: its slices cover ${round2(arc)}% of the dial but its odds are ${g.weight}%.`);
  }
  for (const z of zones) {
    if (!onIds.has(z.gift) || !str(z.big, 1, 12) || !str(z.small, 1, 18)) continue;
    const big = labelFontSize(z.big, arcUnits(z.pct, LABEL.big.radius), LABEL.big.max);
    const small = labelFontSize(z.small, arcUnits(z.pct, LABEL.small.radius), LABEL.small.max);
    if (big < LABEL.big.min || small < LABEL.small.min) warn(`"${z.big} ${z.small}" is squeezed on its ${z.pct}% slice. Shorten the label or give it bigger odds.`);
  }
  return { errors, warnings };
}

export const expiresAt =(from, days) => new Date(from.getTime() + days * 864e5);
export const holdUntil = (from, minutes) => new Date(from.getTime() + minutes * 6e4);
export const dayAgo = (now) => new Date(now.getTime() - 864e5);
