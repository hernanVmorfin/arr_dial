import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adParams, pathOf, referrerOf, gaClientId, klaviyoExchangeId, cleanContext, geoFrom, deviceKind } from './visit.js';
import { homeLine, homeHints, priorLine, visitLine } from './profile.js';
import { memoryDb } from './db-memory.ts';
import { supabaseDb } from './db-supabase.ts';
import { takeTurn, claimGift, addDetails, type Cfg } from './dial.ts';
import { priorFor, enrichEntry, enrichAddress } from './enrich.ts';
import { pasteBlock } from './monday.ts';
import { profileImport, wonEvent } from './klaviyo.ts';
import { addressKey } from './address.ts';
import type { Home } from './db.ts';

const cfg: Cfg = JSON.parse(readFileSync(new URL('../../data/dial.json', import.meta.url), 'utf8'));
const OCT = new Date('2026-10-16T15:00:00Z');
const HOME_ADDR = { street: '14532 S Ravinia Ave', zip: '60462' };
const KEY = addressKey(HOME_ADDR.street, HOME_ADDR.zip);
const HOME: Home = { propertyKey: 'il-cook:1', county: 'Cook', township: 'Orland', yearBuilt: 1956, sqft: 1380, stories: '2', style: '2-story brick', heating: 'Hot Water Steam', centralAir: false, basement: 'Full', basementFinish: 'Unfinished' };
const ZIPS = ['60462', '60805'].map((zip) => ({ zip, name: zip }));
const cookie = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join('; ');

/* ---------------- the visit ---------------- */

test('visit: only utm tags and click ids survive from a query string; paths lose theirs', () => {
  assert.deepEqual(adParams('?utm_source=google&utm_medium=cpc&gclid=abc&email=me@x.com&_kx=KX.123'), { utm_source: 'google', utm_medium: 'cpc', gclid: 'abc', _kx: 'KX.123' });
  assert.equal(adParams('?email=me@x.com'), null);
  assert.equal(pathOf('https://www.alwaysreadyrepair.com/furnace-repair?email=me@x.com#top'), '/furnace-repair');
  assert.equal(referrerOf('https://www.google.com/search?q=furnace', 'www.alwaysreadyrepair.com'), 'google.com/search');
  assert.equal(referrerOf('https://alwaysreadyrepair.com/about', 'www.alwaysreadyrepair.com'), null, 'our own pages are not a referrer');
  assert.equal(deviceKind(390, true), 'mobile');
  assert.equal(deviceKind(1440, false), 'desktop');
});

test('visit: GA client id, and the Klaviyo exchange id from klaviyo.js\'s cookie', () => {
  const kla = Buffer.from(JSON.stringify({ cid: 'x', $exchange_id: 'abc123.VswpAW' })).toString('base64');
  const c = cookie({ _ga: 'GA1.1.123456789.1700000000', __kla_id: kla, _fbp: 'fb.1.1.2' });
  assert.equal(gaClientId(c), '123456789.1700000000');
  assert.equal(klaviyoExchangeId(c), 'abc123.VswpAW');
  assert.equal(klaviyoExchangeId(cookie({ __kla_id: Buffer.from('{"cid":"x"}').toString('base64') })), null, 'not identified yet');
  assert.equal(klaviyoExchangeId('__kla_id=%%%'), null);
});

test('visit: the server keeps known fields only, capped', () => {
  const c = cleanContext({
    firstSeen: '2026-10-02T14:00:00Z', visits: 3, landing: '/furnace-repair', referrer: 'google.com/', ads: { utm_source: 'google', evil: 'x' },
    pages: Array.from({ length: 30 }, (_, i) => `/p${i}`), pageViews: 7, device: 'mobile', screen: '390x844', secondsOnSite: 312,
    ids: { ga: '1.2', kx: 'k', password: 'nope' }, email: 'me@x.com', geo: { city: 'Spoofed' }
  })!;
  assert.equal(c.firstSeen, '2026-10-02T14:00:00.000Z');
  assert.deepEqual(c.ads, { utm_source: 'google' });
  assert.equal((c.pages as string[]).length, 15);
  assert.deepEqual(c.ids, { ga: '1.2', kx: 'k' });
  assert.equal((c as any).email, undefined);
  assert.equal((c as any).geo, undefined, 'the browser can\'t set the location');
  assert.equal(cleanContext({ device: 'fridge', visits: -1 }), null);
  assert.equal(cleanContext('junk'), null);
});

test('visit: the place from Cloudflare, city-level, flagged against ARR\'s ZIPs', () => {
  const g = geoFrom({ city: 'Orland Park', postalCode: '60462', regionCode: 'IL', country: 'US', latitude: '41.61234', longitude: '-87.85678', asOrganization: 'Comcast' }, ZIPS)!;
  assert.deepEqual(g, { city: 'Orland Park', zip: '60462', region: 'IL', country: 'US', lat: 41.61, lon: -87.86, isp: 'Comcast', inArea: true });
  assert.equal(geoFrom({ city: 'Naperville', postalCode: '60540' }, ZIPS)!.inArea, false);
  assert.equal(geoFrom({ city: 'Somewhere' }, [])!.inArea, undefined, 'no ZIP list, no verdict');
  assert.equal(geoFrom(null, ZIPS), null);
});

/* ---------------- what the CSR reads ---------------- */

test('summaries: home, what to ask about, earlier contact, the visit', () => {
  assert.equal(homeLine(HOME), 'built 1956 · 2-story brick · 1,380 sq ft · hot water steam · no central air · full basement, unfinished · Orland Twp, Cook County');
  assert.deepEqual(homeHints(HOME, OCT), ['no central air on record: ask about AC', 'boiler (hot water/steam) heat', '70-year-old home']);
  assert.deepEqual(homeHints({ centralAir: true, heating: 'Warm Air Furnace', yearBuilt: 2010 }, OCT), []);
  assert.equal(priorLine({ checkedAt: '', leads: [{ id: '1', name: 'Maria · 14532 S Ravinia', created: '2026-10-02T15:00:00Z', status: 'New' }], klaviyo: { id: 'k', email: 'maria@x.com', since: '2025-03-04T00:00:00Z' }, atAddress: [{ code: 'ARR-7K3P', gift: 'svc20', status: 'redeemed', created_at: '' }] }),
    'Monday lead Oct 2, 2026: Maria · 14532 S Ravinia (New) · Klaviyo profile since Mar 2025, maria@x.com · other dial codes at this home: ARR-7K3P (redeemed)');
  assert.equal(priorLine({ checkedAt: '' }), '');
  assert.equal(visitLine({ visits: 3, firstSeen: '2026-10-02T15:00:00Z', firstReferrer: 'facebook.com/', firstAds: { fbclid: 'x' }, referrer: 'google.com/', ads: { utm_source: 'google', utm_medium: 'cpc', gclid: 'g' }, landing: '/furnace-repair', pageViews: 4, pages: ['/furnace-repair', '/reviews'], device: 'mobile', geo: { city: 'Orland Park', zip: '60462', inArea: true } }),
    'visit 3 since Oct 2, 2026 · first came from facebook.com/, Meta ad · this visit from google.com/, google/cpc, Google ad · landed on /furnace-repair · 4 pages (/furnace-repair, /reviews) · mobile · near Orland Park 60462 (in area)');
  assert.equal(visitLine({ visits: 1, landing: '/', pageViews: 1 }), 'first visit · this visit from direct · landed on / · 1 page');
});

/* ---------------- from the turn to the code ---------------- */

test('the visit rides from the turn to the code; addresses get a key for "other codes at this home"', async () => {
  const db = memoryDb({ properties: { [KEY]: 'il-cook:1' }, homes: { [KEY]: HOME } });
  const context = { visits: 2, device: 'mobile', geo: { city: 'Orland Park', zip: '60462', inArea: true } };
  const t = await takeTurn(db, cfg, { ip: '1.1.1.1', device: 'dev-ctx-abcdefgh', ipLimits: true, context }, OCT, () => 0.1);
  if (!t.ok) throw new Error('turn');
  assert.deepEqual(db.turns[0].context, context);
  const c = await claimGift(db, cfg, { turnId: t.turn.id, phone: '7085550501', ip: '1.1.1.2', ipLimits: true }, OCT);
  if (!c.ok || c.duplicate) throw new Error('claim');
  assert.deepEqual(c.entry.context, context);
  assert.equal(c.entry.address_key ?? null, null, 'no address at a regular claim');
  const d = await addDetails(db, cfg, { turnId: t.turn.id, firstName: 'Maria', ...HOME_ADDR });
  assert.ok(d.ok && d.entry.address_key === KEY);

  const tm = await takeTurn(db, cfg, { ip: '1.1.1.3', device: 'dev-ctx-2-abcdefgh', ipLimits: true }, OCT, () => 0.97);
  if (!tm.ok || tm.gift.id !== 'mem') throw new Error('mem turn');
  const cm = await claimGift(db, cfg, { turnId: tm.turn.id, phone: '7085550502', ip: '1.1.1.4', ipLimits: true, ...HOME_ADDR }, OCT);
  assert.ok(cm.ok && !cm.duplicate && cm.entry.address_key === KEY, 'a free-year claim has its address at once');
});

test('enrichment: home record, earlier Monday leads (minus its own item), Klaviyo, other codes at the home', async () => {
  const db = memoryDb({ properties: { [KEY]: 'il-cook:1' }, homes: { [KEY]: HOME } });
  const win = async (phone: string, rand: number, extra = {}) => {
    const t = await takeTurn(db, cfg, { ip: `2.2.2.${phone.slice(-2)}`, device: `dev-${phone}-abc`, ipLimits: true }, OCT, () => rand);
    if (!t.ok) throw new Error('turn');
    const c = await claimGift(db, cfg, { turnId: t.turn.id, phone, ip: `3.3.3.${phone.slice(-2)}`, ipLimits: true, ...extra }, OCT);
    if (!c.ok || c.duplicate) throw new Error('claim');
    return { entry: c.entry, turn: t.turn };
  };
  const first = await win('7085550601', 0.1);
  await addDetails(db, cfg, { turnId: first.turn.id, ...HOME_ADDR });
  const { entry } = await win('7085550602', 0.97, HOME_ADDR);   // the free year, same home

  const deps = {
    findLeads: async () => [
      { id: '9', name: `Comfort Dial ${entry.code}: free year`, created: OCT.toISOString() },
      { id: '8', name: 'Maria · Instant Pricing', created: '2026-10-02T15:00:00Z', status: 'New' }
    ],
    findProfile: async () => ({ id: 'K1', email: 'maria@x.com', since: '2025-03-04T00:00:00Z' })
  };
  const x = await enrichEntry({}, db, entry, OCT, deps);
  assert.deepEqual(x.home, HOME);
  assert.deepEqual(x.prior!.leads!.map((l) => l.id), ['8'], 'its own Monday item is not "before"');
  assert.equal(x.prior!.klaviyo!.email, 'maria@x.com');
  assert.deepEqual(x.prior!.atAddress!.map((a) => a.code), [first.entry.code]);
  assert.deepEqual(db.entries.find((e) => e.id === entry.id)!.home, HOME, 'saved on the code');

  const broken = await priorFor({}, db, entry, OCT, { findLeads: async () => { throw new Error('monday down'); }, findProfile: async () => null });
  assert.match(broken.errors![0], /leads: Error: monday down/);
  assert.equal(broken.klaviyo, null);
  assert.equal(broken.atAddress!.length, 1, 'one failure doesn\'t stop the rest');
});

test('enrichment after "book faster" finds the home without asking Monday or Klaviyo again', async () => {
  const db = memoryDb({ homes: { [KEY]: HOME } });
  const t = await takeTurn(db, cfg, { ip: '4.4.4.4', device: 'dev-late-abcdefgh', ipLimits: true }, OCT, () => 0.1);
  if (!t.ok) throw new Error('turn');
  const c = await claimGift(db, cfg, { turnId: t.turn.id, phone: '7085550701', ip: '4.4.4.5', ipLimits: true }, OCT);
  if (!c.ok || c.duplicate) throw new Error('claim');
  const early = await enrichEntry({}, db, c.entry, OCT, { findLeads: async () => [], findProfile: async () => ({ id: 'K', since: OCT.toISOString() }) });
  assert.equal(early.home ?? null, null);
  const d = await addDetails(db, cfg, { turnId: t.turn.id, ...HOME_ADDR });
  if (!d.ok) throw new Error('details');
  const late = await enrichAddress(db, d.entry, OCT);
  assert.deepEqual(late.home, HOME);
  assert.equal(late.prior!.klaviyo!.id, 'K', 'kept from the win');
});

/* ---------------- what Monday and Klaviyo get ---------------- */

test('Monday notes and Klaviyo payloads carry the home and the visit; _kx joins the Klaviyo profile', () => {
  const e: any = {
    id: 'e', code: 'ARR-7K3P', turn_id: 't', phone: '7085550142', gift: 'svc20', mem_month: null, first_name: 'Maria', address: '14532 S Ravinia Ave', zip: '60462',
    household_key: null, sms_marketing: false, utm: null, page: null, ip: null, monday_item_id: null, created_at: OCT.toISOString(),
    expires_at: '2026-11-15T15:00:00.000Z', redeemed_at: null, redeemed_note: null, home: HOME,
    prior: { checkedAt: '', klaviyo: { id: 'k', since: '2025-03-04T00:00:00Z' } },
    context: { visits: 1, landing: '/', pageViews: 2, device: 'mobile', geo: { city: 'Orland Park', inArea: true }, ids: { kx: 'abc.VswpAW' } }
  };
  const gift = cfg.gifts.find((g) => g.id === 'svc20')!;
  const block = pasteBlock(e, gift, cfg);
  assert.match(block, /Home \(county record\): built 1956 · 2-story brick/);
  assert.match(block, /Worth asking: no central air on record: ask about AC; boiler/);
  assert.match(block, /Seen before: Klaviyo profile since Mar 2025/);
  assert.match(block, /Visit: first visit · this visit from direct · landed on \/ · 2 pages · mobile · near Orland Park \(in area\)/);
  const p = profileImport(e).data.attributes as any;
  assert.equal(p._kx, 'abc.VswpAW');
  assert.deepEqual(p.properties, { arr_home_year_built: 1956, arr_home_sqft: 1380, arr_home_stories: '2', arr_home_heating: 'Hot Water Steam', arr_home_central_air: false, arr_home_basement: 'Full', arr_visit_device: 'mobile', arr_visit_city: 'Orland Park', arr_visit_in_area: true });
  const w = wonEvent(e, gift, cfg).data.attributes as any;
  assert.equal(w.properties.home_central_air, false);
  assert.equal(w.profile.data.attributes._kx, undefined, 'the Won event keeps its plain profile; the join is a separate call');
});

test('Supabase inserts leave out empty context and version 0, so older databases keep working', async () => {
  const bodies: any[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return new Response(null, { status: 201 }); }) as typeof fetch;
  const db = supabaseDb({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x' }, fetcher);
  const base = { id: 'a', gift: 'svc20', mem_month: null, ip: null, device: null, created_at: '', held_until: '', claimed_at: null, entry_id: null };
  await db.insertTurn({ ...base, config_version: 0, context: null });
  await db.insertTurn({ ...base, config_version: 3, context: { device: 'mobile' } });
  assert.equal('config_version' in bodies[0] || 'context' in bodies[0], false);
  assert.equal(bodies[1].config_version, 3);
  assert.deepEqual(bodies[1].context, { device: 'mobile' });
});
