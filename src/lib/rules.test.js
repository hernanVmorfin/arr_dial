import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chicagoMonth, chicagoDate, pickGift, giftsInPlay, oddsInPlay, membershipsLeft, nextMembershipMonth, makeCode, isCode,
  isUuid, normPhone, cleanFirstName, validateAddress, labelFontSize, arcUnits, LABEL
} from './rules.js';

const cfg = JSON.parse(readFileSync(new URL('../../data/dial.json', import.meta.url), 'utf8'));

test('weights sum to 100 and the dial zones give every gift an arc equal to its odds', () => {
  assert.equal(cfg.gifts.reduce((s, g) => s + g.weight, 0), 100);
  assert.equal(cfg.zones.reduce((s, z) => s + z.pct, 0), 100);
  for (const g of cfg.gifts) {
    const arc = cfg.zones.filter((z) => z.gift === g.id).reduce((s, z) => s + z.pct, 0);
    assert.equal(arc, g.weight, `${g.id}: arc ${arc}% vs odds ${g.weight}%`);
  }
});

test('the free year sits at 72°F on the 50–90° scale', () => {
  let start = 0;
  for (const z of cfg.zones) {
    if (z.gift === cfg.membership.giftId) {
      const mid = 50 + ((start + z.pct / 2) / 100) * 40;
      assert.ok(Math.abs(mid - 72) < 0.01, `free year centre ${mid}`);
    }
    start += z.pct;
  }
});

test('dial labels lead with a dollar value and stay big enough to read once fitted to their arc', () => {
  // src/widget/face.js draws with LABEL; its radius is a plain slice's, the tighter case (the top prize sits raised)
  for (const z of cfg.zones) {
    assert.match(z.big, /^\$\d+/, `${z.gift} big label leads with a dollar value`);
    const big = labelFontSize(z.big, arcUnits(z.pct, LABEL.big.radius), LABEL.big.max);
    const small = labelFontSize(z.small, arcUnits(z.pct, LABEL.small.radius), LABEL.small.max);
    assert.ok(big >= LABEL.big.min, `${z.big} shrinks to ${big.toFixed(1)}`);
    assert.ok(small >= LABEL.small.min, `${z.small} shrinks to ${small.toFixed(1)}`);
  }
});

test('chicagoMonth flips at Chicago midnight, not UTC', () => {
  assert.equal(chicagoMonth(new Date('2026-11-01T04:30:00Z')), '2026-10');   // 11:30pm Oct 31 in Chicago
  assert.equal(chicagoMonth(new Date('2026-11-01T05:30:00Z')), '2026-11');
  assert.equal(chicagoDate('2026-11-16T03:00:00Z'), 'November 15, 2026');
});

test('free year drops out of play when this month has none, and the odds renormalise', () => {
  assert.ok(giftsInPlay(cfg, true).some((g) => g.id === 'mem'));
  assert.ok(!giftsInPlay(cfg, false).some((g) => g.id === 'mem'));
  for (let i = 0; i < 2000; i++) assert.notEqual(pickGift(cfg, false).id, 'mem');
  const o = oddsInPlay(cfg, false);
  assert.equal(o.mem, 0);
  assert.ok(Math.abs(o.svc20 - 45 / 95 * 100) < 1e-9);
  assert.ok(Math.abs(Object.values(o).reduce((s, n) => s + n, 0) - 100) < 1e-9);
});

test('pickGift follows the weights', () => {
  let i = 0; const seq = [0, 0.449, 0.45, 0.649, 0.65, 0.799, 0.8, 0.949, 0.95, 0.999];
  const ids = seq.map(() => pickGift(cfg, true, () => seq[i++]).id);
  assert.deepEqual(ids, ['svc20', 'svc20', 'duct50', 'duct50', 'wh50', 'wh50', 'call', 'call', 'mem', 'mem']);
  assert.equal(pickGift(cfg, false, () => 0.999).id, 'call');
});

test('free years left and next unlock', () => {
  assert.equal(membershipsLeft(cfg, '2026-10', []), 5);
  assert.equal(membershipsLeft(cfg, '2026-10', ['2026-10']), 4);
  assert.equal(membershipsLeft(cfg, '2026-12', ['2026-10']), 3);
  assert.equal(membershipsLeft(cfg, '2027-03', []), 0);
  assert.equal(nextMembershipMonth(cfg, '2026-10'), '2026-11');
  assert.equal(nextMembershipMonth(cfg, '2027-02'), null);
});

test('codes avoid look-alike characters', () => {
  for (let i = 0; i < 500; i++) assert.ok(isCode(makeCode()));
  assert.ok(!isCode('ARR-0OIL'));
});

test('ids, phones and names', () => {
  assert.ok(isUuid(crypto.randomUUID()));
  assert.ok(!isUuid('not-a-uuid'));
  assert.equal(normPhone('(708) 555-0142'), '7085550142');
  assert.equal(normPhone('+1 708 555 0142'), '7085550142');
  assert.equal(normPhone('555-0142'), null);
  assert.equal(normPhone('(108) 555-0142'), null);
  assert.equal(cleanFirstName('maria lopez'), 'Maria');
  assert.equal(cleanFirstName("O'Neil"), "O'Neil");
  assert.equal(cleanFirstName('http://spam.example'), null);
  assert.equal(cleanFirstName(''), null);
});

test('address validation', () => {
  assert.deepEqual(validateAddress({ street: ' 14532  S Ravinia Ave ', zip: '60462' }, cfg), { ok: true, data: { street: '14532 S Ravinia Ave', zip: '60462' } });
  assert.equal(validateAddress({ street: 'Ravinia Ave', zip: '60462' }, cfg).field, 'street');
  assert.equal(validateAddress({ street: '1 Main St', zip: '6046' }, cfg).field, 'zip');
  assert.equal(validateAddress({ street: '1 Main St', zip: '53202' }, cfg).field, 'zip');
});

/* ---------------- the admin's config rules ---------------- */
import { validateConfig, layoutZones, activeGifts, contrast, chicagoDay, chicagoMidnight, addDays } from './rules.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

test('the built-in config passes validation with no warnings', () => {
  assert.deepEqual(validateConfig(cfg), { errors: [], warnings: [] });
  assert.deepEqual(validateConfig(cfg, cfg), { errors: [], warnings: [] });
});

test('layoutZones keeps the order and each gift\'s split, scaled to new odds', () => {
  const gifts = clone(cfg.gifts);
  gifts.find((g) => g.id === 'svc20').weight = 40;
  gifts.find((g) => g.id === 'duct50').weight = 25;
  const z = layoutZones(cfg.zones, gifts);
  assert.deepEqual(z.map((x) => x.gift), cfg.zones.map((x) => x.gift));
  const svc = z.filter((x) => x.gift === 'svc20').map((x) => x.pct);
  assert.deepEqual(svc, [28.89, 11.11]);   // 32.5 : 12.5 of 40
  assert.equal(z.find((x) => x.gift === 'duct50').pct, 25);
  assert.deepEqual(validateConfig({ ...cfg, gifts, zones: z }).errors, []);
});

test('layoutZones drops a gift that is off, adds a new one on the HEAT end, and takes labels from the gift', () => {
  const gifts = clone(cfg.gifts);
  gifts.find((g) => g.id === 'wh50').active = false;
  gifts.push({ id: 'tune', short: '$40 OFF TUNE-UP', name: '$40 off a tune-up', sub: 'Furnace or AC', weight: 15, value: 40, fill: '#14284e', ink: '#f9f7f8', big: '$40 OFF', small: 'TUNE-UP' });
  const z = layoutZones(cfg.zones, gifts);
  assert.ok(!z.some((x) => x.gift === 'wh50'));
  assert.deepEqual(z.at(-1), { gift: 'tune', pct: 15, big: '$40 OFF', small: 'TUNE-UP' });
  const next = { ...cfg, gifts, zones: z };
  assert.deepEqual(validateConfig(next, cfg).errors, []);
  assert.ok(!activeGifts(next).some((g) => g.id === 'wh50'));
  assert.ok(!giftsInPlay(next, true).some((g) => g.id === 'wh50'));
  assert.equal(oddsInPlay(next, true).wh50, 0);
  for (let i = 0; i < 500; i++) assert.notEqual(pickGift(next, true).id, 'wh50');
});

test('validateConfig refuses odds that don\'t add up, a deleted gift, and a broken colour', () => {
  const off = clone(cfg); off.gifts[0].weight = 40;
  assert.match(validateConfig(off).errors.join(' '), /add up to 95%/);
  const gone = clone(cfg); gone.gifts = gone.gifts.filter((g) => g.id !== 'call'); gone.zones = gone.zones.filter((z) => z.gift !== 'call');
  gone.gifts[0].weight = 60; gone.zones = layoutZones(gone.zones, gone.gifts);
  assert.match(validateConfig(gone, cfg).errors.join(' '), /Switch it off instead of deleting it/);
  const ugly = clone(cfg); ugly.gifts[1].fill = 'blue';
  assert.match(validateConfig(ugly).errors.join(' '), /hex/);
  const freeOnly = clone(cfg); freeOnly.gifts.forEach((g) => { if (g.id !== 'mem') g.active = false; });
  freeOnly.gifts.find((g) => g.id === 'mem').weight = 100; freeOnly.zones = layoutZones(freeOnly.zones, freeOnly.gifts);
  assert.match(validateConfig(freeOnly).errors.join(' '), /besides the free year/);
});

test('validateConfig warns about squeezed labels and low contrast but lets them through', () => {
  const c = clone(cfg);
  const svc = c.gifts.find((g) => g.id === 'svc20'), wh = c.gifts.find((g) => g.id === 'wh50');
  svc.weight = 57; wh.weight = 3; wh.ink = '#ee3333';
  c.zones = layoutZones(c.zones, c.gifts);
  const r = validateConfig(c);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /squeezed/.test(w)));
  assert.ok(r.warnings.some((w) => /hard to read/.test(w)));
  assert.ok(contrast('#084e91', '#f9f7f8') > 7);
});

test('Chicago days and midnights across daylight saving', () => {
  assert.equal(chicagoDay(new Date('2026-11-01T04:30:00Z')), '2026-10-31');
  assert.equal(chicagoMidnight('2026-10-20').toISOString(), '2026-10-20T05:00:00.000Z');   // CDT
  assert.equal(chicagoMidnight('2026-12-01').toISOString(), '2026-12-01T06:00:00.000Z');   // CST
  assert.equal(chicagoMidnight('2026-11-01').toISOString(), '2026-11-01T05:00:00.000Z');   // the night clocks fall back
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

/* ---------------- the free-year schedule ---------------- */
import { freeYearStatus, scarcityLine, monthName } from './rules.js';

const withMonths = (months) => ({ ...clone(cfg), membership: { ...cfg.membership, months } });

test('validateConfig: free-year months are listed and in order; a won month stays; an ended month can\'t be added', () => {
  assert.match(validateConfig(withMonths([])).errors.join(' '), /pick at least one/);
  assert.match(validateConfig(withMonths(['2026-11', '2026-10'])).errors.join(' '), /calendar order/);
  assert.match(validateConfig(withMonths(['2026-10', '2026-10'])).errors.join(' '), /distinct/);
  const ctx = { month: '2026-11', claimed: ['2026-10'] };
  assert.match(validateConfig(withMonths(['2026-11', '2026-12']), cfg, ctx).errors.join(' '), /October 2026's free year was won/);
  assert.match(validateConfig(withMonths(['2026-09', ...cfg.membership.months]), cfg, ctx).errors.join(' '), /September 2026 has ended/);
  assert.deepEqual(validateConfig(withMonths(['2026-10', '2026-12', '2027-03']), cfg, ctx).errors, [], 'drop months to come, add a later one');
  assert.deepEqual(validateConfig(withMonths(['2026-10', '2026-11']), withMonths(['2026-09', '2026-10', '2026-11']), ctx).errors, [], 'an ended month nobody won can go');
  assert.deepEqual(validateConfig(withMonths(['2026-11']), cfg).errors, [], 'without the database, only the shape is checked');
});

test('the line under the dial follows the schedule', () => {
  const s = withMonths(['2026-10', '2026-12']);
  assert.equal(scarcityLine(freeYearStatus(s, '2026-10', [])), 'October\'s free year is still up for grabs');
  assert.equal(scarcityLine(freeYearStatus(s, '2026-10', ['2026-10'])), 'October\'s free year is taken. Next one: Dec 1');
  assert.equal(scarcityLine(freeYearStatus(s, '2026-11', ['2026-10'])), 'December\'s free year unlocks Dec 1', 'a month with none says when the next comes');
  assert.equal(scarcityLine(freeYearStatus(s, '2026-09', [])), 'October\'s free year unlocks Oct 1', 'before the season');
  assert.equal(scarcityLine(freeYearStatus(s, '2026-12', ['2026-10', '2026-12'])), 'This season\'s free years are all claimed');
  const off = clone(s);
  off.gifts.find((g) => g.id === 'mem').active = false;
  assert.equal(scarcityLine(freeYearStatus(off, '2026-10', [])), '', 'nothing about a free year that is off the dial');
  assert.equal(scarcityLine(null), '');
  assert.deepEqual(freeYearStatus(s, '2026-11', []), { month: '2026-11', freeYear: true, inSeason: false, membershipOpen: false, membershipsLeft: 1, membershipsTotal: 2, nextUnlock: '2026-12' });
  assert.deepEqual([monthName('2027-01'), monthName('2026-12', { year: false })], ['January 2027', 'December']);
});
