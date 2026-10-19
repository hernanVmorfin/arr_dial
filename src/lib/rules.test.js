import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chicagoMonth, chicagoDate, pickGift, giftsInPlay, oddsInPlay, membershipsLeft, nextMembershipMonth, makeCode, isCode,
  isUuid, normPhone, cleanFirstName, validateAddress, labelFontSize, arcUnits, RING, labelRadii
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
  // the widget draws with the same RING; checked at the plain outer edge, the tighter case (the top prize sits raised)
  const r = labelRadii(RING.outer);
  for (const z of cfg.zones) {
    assert.match(z.big, /^\$\d+/, `${z.gift} big label leads with a dollar value`);
    const big = labelFontSize(z.big, arcUnits(z.pct, r.big), RING.big);
    const small = labelFontSize(z.small, arcUnits(z.pct, r.small), RING.small);
    assert.ok(big >= 13, `${z.big} shrinks to ${big.toFixed(1)}`);
    assert.ok(small >= 7.5, `${z.small} shrinks to ${small.toFixed(1)}`);
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
