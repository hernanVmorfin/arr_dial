import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { takeTurn, claimGift, addDetails, status, type Cfg } from './dial.ts';
import { memoryDb } from './db-memory.ts';
import { addressKey } from './address.ts';
import { isCode } from './rules.js';

const cfg: Cfg = JSON.parse(readFileSync(new URL('../../data/dial.json', import.meta.url), 'utf8'));
const OCT = new Date('2026-10-16T15:00:00Z');
const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 6e4);
const HOME = { street: '14532 S Ravinia Ave', zip: '60462' };
const props = { [addressKey(HOME.street, HOME.zip)]: 'cook:27101000000000' };
const memRand = () => 0.97;       // lands in the free year's 5% when it is in play
const svcRand = () => 0.1;        // $20 off any service
let n = 0;
const ipIn = () => ({ ip: `10.0.0.${++n}`, device: `dev-${n}-abcdefgh`, ipLimits: true });
const claimIn = (turnId: string, phone: string, extra: Record<string, unknown> = {}) => ({ turnId, phone, ip: `10.1.0.${++n}`, ipLimits: true, ...extra });

test('a turn picks a gift, holds it, and a claim with a phone issues a code', async () => {
  const db = memoryDb();
  const t = await takeTurn(db, cfg, ipIn(), OCT, svcRand);
  assert.ok(t.ok);
  if (!t.ok) return;
  assert.equal(t.gift.id, 'svc20');
  assert.equal(new Date(t.turn.held_until).getTime(), minutes(OCT, 10).getTime());
  const c = await claimGift(db, cfg, claimIn(t.turn.id, '(708) 555-0142', { reminders: true, utm: { utm_source: 'fb', evil: 'x' } }), minutes(OCT, 2));
  assert.ok(c.ok && !c.duplicate);
  if (!c.ok || c.duplicate) return;
  assert.match(c.entry.code, /^SVC20-[A-Z0-9]{5}$/, 'the promo\'s prefix starts the code');
  assert.ok(isCode(c.entry.code));
  assert.equal(c.entry.phone, '7085550142');
  assert.equal(c.entry.sms_marketing, true);
  assert.deepEqual(c.entry.utm, { utm_source: 'fb' });
  assert.equal(c.fresh, true);
  assert.equal(new Date(c.entry.expires_at).getTime(), new Date(minutes(OCT, 2).getTime() + 30 * 864e5).getTime());
  assert.equal(db.turns[0].entry_id, c.entry.id);
});

test('each promo\'s codes start with its prefix and last its own number of days', async () => {
  const db = memoryDb({ properties: props });
  const custom: Cfg = { ...cfg, gifts: cfg.gifts.map((g) => (g.id === 'mem' ? { ...g, expiresDays: 60 } : g)) };
  const t = await takeTurn(db, custom, ipIn(), OCT, memRand);
  assert.ok(t.ok && t.gift.id === 'mem');
  if (!t.ok) return;
  const c = await claimGift(db, custom, claimIn(t.turn.id, '7085550170', HOME), OCT);
  assert.ok(c.ok && !c.duplicate);
  if (!c.ok || c.duplicate) return;
  assert.match(c.entry.code, /^YEAR-/);
  assert.equal(new Date(c.entry.expires_at).getTime(), OCT.getTime() + 60 * 864e5, 'the free year\'s own 60 days');
  const t2 = await takeTurn(db, custom, ipIn(), OCT, svcRand);
  const c2 = t2.ok ? await claimGift(db, custom, claimIn(t2.turn.id, '7085550171'), OCT) : null;
  assert.ok(c2 && c2.ok && !c2.duplicate);
  if (c2 && c2.ok && !c2.duplicate) assert.equal(new Date(c2.entry.expires_at).getTime(), OCT.getTime() + 30 * 864e5, 'the default 30 days');
});

test('claiming the same turn twice returns the same code and is not fresh', async () => {
  const db = memoryDb();
  const t = await takeTurn(db, cfg, ipIn(), OCT, svcRand);
  if (!t.ok) throw new Error('turn');
  const a = await claimGift(db, cfg, claimIn(t.turn.id, '7085550142'), OCT);
  const b = await claimGift(db, cfg, claimIn(t.turn.id, '7085550142'), OCT);
  assert.ok(a.ok && !a.duplicate && b.ok && !b.duplicate);
  if (!a.ok || a.duplicate || !b.ok || b.duplicate) return;
  assert.equal(a.entry.code, b.entry.code);
  assert.equal(b.fresh, false);
  assert.equal(db.entries.length, 1);
});

test('one gift per phone: a second win for the same number is a duplicate and reveals nothing', async () => {
  const db = memoryDb();
  const t1 = await takeTurn(db, cfg, ipIn(), OCT, svcRand);
  const t2 = await takeTurn(db, cfg, ipIn(), OCT, svcRand);
  if (!t1.ok || !t2.ok) throw new Error('turn');
  await claimGift(db, cfg, claimIn(t1.turn.id, '7085550142'), OCT);
  const dup = await claimGift(db, cfg, claimIn(t2.turn.id, '708-555-0142'), OCT);
  assert.deepEqual(dup, { ok: true, duplicate: true });
  assert.equal(db.entries.length, 1);
});

test('a claim after the hold (plus a minute of grace) is refused as expired', async () => {
  const db = memoryDb();
  const t = await takeTurn(db, cfg, ipIn(), OCT, svcRand);
  if (!t.ok) throw new Error('turn');
  const ok = await claimGift(db, cfg, claimIn(t.turn.id, '7085550143'), minutes(OCT, 10.5));
  assert.ok(ok.ok);
  const t2 = await takeTurn(db, cfg, ipIn(), OCT, svcRand);
  if (!t2.ok) throw new Error('turn');
  const late = await claimGift(db, cfg, claimIn(t2.turn.id, '7085550144'), minutes(OCT, 11.5));
  assert.ok(!late.ok);
  if (late.ok) return;
  assert.equal(late.status, 410);
  assert.equal(late.reason, 'expired');
});

test('bad input: no turn, unknown turn, bad phone', async () => {
  const db = memoryDb();
  const a = await claimGift(db, cfg, claimIn('nope', '7085550142'), OCT);
  assert.ok(!a.ok && a.status === 400);
  const b = await claimGift(db, cfg, claimIn(crypto.randomUUID(), '7085550142'), OCT);
  assert.ok(!b.ok && b.status === 404);
  const t = await takeTurn(db, cfg, ipIn(), OCT, svcRand);
  if (!t.ok) throw new Error('turn');
  const c = await claimGift(db, cfg, claimIn(t.turn.id, '555-0142'), OCT);
  assert.ok(!c.ok && c.field === 'phone');
});

test('turn limits: per device and per IP, and the IP limit can be switched off', async () => {
  const db = memoryDb();
  const dev = { ip: '10.9.9.9', device: 'same-device-123', ipLimits: true };
  for (let i = 0; i < cfg.limits.turnsPerDevicePerDay; i++) assert.ok((await takeTurn(db, cfg, dev, OCT, svcRand)).ok);
  const r = await takeTurn(db, cfg, dev, OCT, svcRand);
  assert.ok(!r.ok && r.status === 429 && r.reason === 'limit');
  assert.ok((await takeTurn(db, cfg, dev, minutes(OCT, 24 * 60 + 1), svcRand)).ok, 'a day later the device can turn again');

  const db2 = memoryDb();
  for (let i = 0; i < cfg.limits.turnsPerIpPerDay; i++) assert.ok((await takeTurn(db2, cfg, { ip: '10.8.8.8', device: `d-${i}-xxxxxxxx`, ipLimits: true }, OCT, svcRand)).ok);
  assert.ok(!(await takeTurn(db2, cfg, { ip: '10.8.8.8', device: 'fresh-device-1', ipLimits: true }, OCT, svcRand)).ok);
  assert.ok((await takeTurn(db2, cfg, { ip: '10.8.8.8', device: 'fresh-device-2', ipLimits: false }, OCT, svcRand)).ok);
});

test('claims per IP per day are capped', async () => {
  const db = memoryDb();
  for (let i = 0; i < cfg.limits.claimsPerIpPerDay + 1; i++) {
    const t = await takeTurn(db, cfg, ipIn(), OCT, svcRand);
    if (!t.ok) throw new Error('turn');
    const c = await claimGift(db, cfg, { turnId: t.turn.id, phone: `70855501${String(i).padStart(2, '0')}`, ip: '10.7.7.7', ipLimits: true }, OCT);
    if (i < cfg.limits.claimsPerIpPerDay) assert.ok(c.ok, `claim ${i}`);
    else assert.ok(!c.ok && c.status === 429);
  }
});

test('the free year: held for one turn only, needs a county-matched address, then gone for the month', async () => {
  const db = memoryDb({ properties: props });
  const t1 = await takeTurn(db, cfg, ipIn(), OCT, memRand);
  if (!t1.ok) throw new Error('turn');
  assert.equal(t1.gift.id, 'mem');
  assert.equal(t1.turn.mem_month, '2026-10');

  // while it is held, nobody else can land on it
  for (let i = 0; i < 20; i++) {
    const t = await takeTurn(db, cfg, ipIn(), OCT, memRand);
    assert.ok(t.ok && t.gift.id !== 'mem');
  }

  const noAddr = await claimGift(db, cfg, claimIn(t1.turn.id, '7085550150'), minutes(OCT, 3));
  assert.ok(!noAddr.ok && noAddr.field === 'street');
  const unknown = await claimGift(db, cfg, claimIn(t1.turn.id, '7085550150', { street: '1 Nowhere Ln', zip: '60462' }), minutes(OCT, 3));
  assert.ok(!unknown.ok && unknown.field === 'street');
  const won = await claimGift(db, cfg, claimIn(t1.turn.id, '7085550150', { street: '14532 South Ravinia Avenue', zip: '60462' }), minutes(OCT, 4));
  assert.ok(won.ok && !won.duplicate);
  if (!won.ok || won.duplicate) return;
  assert.equal(won.entry.household_key, 'pk:cook:27101000000000');
  assert.equal(won.entry.mem_month, '2026-10');

  const st = await status(db, cfg, OCT);
  assert.equal(st.membershipOpen, false);
  assert.equal(st.membershipsLeft, 4);
  assert.equal(st.nextUnlock, '2026-11');
  const later = await takeTurn(db, cfg, ipIn(), minutes(OCT, 60), memRand);
  assert.ok(later.ok && later.gift.id !== 'mem', 'October\'s is claimed');

  // November: a new one, but not for the same home
  const NOV = new Date('2026-11-03T15:00:00Z');
  const t2 = await takeTurn(db, cfg, ipIn(), NOV, memRand);
  if (!t2.ok) throw new Error('turn');
  assert.equal(t2.gift.id, 'mem');
  const again = await claimGift(db, cfg, claimIn(t2.turn.id, '7085550151', HOME), NOV);
  assert.ok(!again.ok && again.reason === 'household');
  assert.ok((await takeTurn(db, cfg, ipIn(), NOV, memRand)).ok);
  assert.equal((await db.membership('2026-11'))!.claimed_at, null, 'the hold went back in the pot');
});

test('an unclaimed free-year hold expires and the next turn can take it', async () => {
  const db = memoryDb({ properties: props });
  const t1 = await takeTurn(db, cfg, ipIn(), OCT, memRand);
  if (!t1.ok || t1.gift.id !== 'mem') throw new Error('turn');
  const t2 = await takeTurn(db, cfg, ipIn(), minutes(OCT, 11), memRand);
  if (!t2.ok) throw new Error('turn');
  assert.equal(t2.gift.id, 'mem');
  const stale = await claimGift(db, cfg, claimIn(t1.turn.id, '7085550160', HOME), minutes(OCT, 10.9));
  assert.ok(!stale.ok && stale.reason === 'expired', 'the first holder lost it to the second');
  const ok = await claimGift(db, cfg, claimIn(t2.turn.id, '7085550161', HOME), minutes(OCT, 12));
  assert.ok(ok.ok && !ok.duplicate);
});

test('a repeat phone landing on the free year gives the hold back', async () => {
  const db = memoryDb({ properties: props });
  const t0 = await takeTurn(db, cfg, ipIn(), OCT, svcRand);
  if (!t0.ok) throw new Error('turn');
  await claimGift(db, cfg, claimIn(t0.turn.id, '7085550170'), OCT);
  const t1 = await takeTurn(db, cfg, ipIn(), OCT, memRand);
  if (!t1.ok || t1.gift.id !== 'mem') throw new Error('turn');
  const dup = await claimGift(db, cfg, claimIn(t1.turn.id, '7085550170', HOME), OCT);
  assert.deepEqual(dup, { ok: true, duplicate: true });
  const t2 = await takeTurn(db, cfg, ipIn(), minutes(OCT, 1), memRand);
  assert.ok(t2.ok && t2.gift.id === 'mem', 'available again right away');
});

test('outside the season no free year is in play', async () => {
  const db = memoryDb();
  const t = await takeTurn(db, cfg, ipIn(), new Date('2027-04-10T15:00:00Z'), memRand);
  assert.ok(t.ok && t.gift.id !== 'mem');
  const st = await status(db, cfg, new Date('2027-04-10T15:00:00Z'));
  assert.equal(st.membershipOpen, false);
  assert.equal(st.membershipsLeft, 0);
});

test('details: name and address after a win; a free-year address stays locked', async () => {
  const db = memoryDb({ properties: props });
  const t = await takeTurn(db, cfg, ipIn(), OCT, svcRand);
  if (!t.ok) throw new Error('turn');
  await claimGift(db, cfg, claimIn(t.turn.id, '7085550180'), OCT);
  const bad = await addDetails(db, cfg, { turnId: t.turn.id, firstName: 'Maria', street: 'nowhere', zip: '60462' });
  assert.ok(!bad.ok && bad.field === 'street');
  const ok = await addDetails(db, cfg, { turnId: t.turn.id, firstName: 'maria', street: '8120 W 159th St', zip: '60462' });
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.entry.first_name, 'Maria');
  assert.equal(ok.entry.address, '8120 W 159th St');

  const tm = await takeTurn(db, cfg, ipIn(), OCT, memRand);
  if (!tm.ok) throw new Error('turn');
  await claimGift(db, cfg, claimIn(tm.turn.id, '7085550181', HOME), OCT);
  const mem = await addDetails(db, cfg, { turnId: tm.turn.id, firstName: 'Dan', street: '1 Other St', zip: '60462' });
  assert.ok(mem.ok);
  if (!mem.ok) return;
  assert.equal(mem.entry.address, HOME.street);
  assert.equal(mem.entry.first_name, 'Dan');
});

test('redeem via Monday item marks the code once', async () => {
  const db = memoryDb();
  const t = await takeTurn(db, cfg, ipIn(), OCT, svcRand);
  if (!t.ok) throw new Error('turn');
  const c = await claimGift(db, cfg, claimIn(t.turn.id, '7085550190'), OCT);
  if (!c.ok || c.duplicate) throw new Error('claim');
  await db.updateEntry(c.entry.id, { monday_item_id: '123' });
  assert.equal((await db.redeemByMondayItem('123', OCT, 'test'))?.code, c.entry.code);
  assert.equal(await db.redeemByMondayItem('123', OCT, 'test'), null, 'second redeem matches nothing');
});
