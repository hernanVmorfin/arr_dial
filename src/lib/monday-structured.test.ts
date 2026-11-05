import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDialItem, updateDialItem, syncDialItem, MONDAY_COLUMNS } from './monday.ts';
import type { Entry } from './db.ts';
import type { Cfg } from './dial.ts';

const cfg: Cfg = JSON.parse(readFileSync(new URL('../../data/dial.json', import.meta.url), 'utf8'));
const gift = cfg.gifts.find(g => g.id === 'svc20')!;
const entry: Entry = {
  id: 'e1', code: 'ARR-7K3P', turn_id: 't1', phone: '7085550142', gift: 'svc20', mem_month: null,
  first_name: null, address: null, zip: null, household_key: null, sms_marketing: false,
  utm: { utm_source: 'google', utm_campaign: 'fall' }, page: 'https://www.alwaysreadyrepair.com/furnace', ip: null,
  monday_item_id: '123', created_at: '2026-11-06T01:30:00.000Z', expires_at: '2026-12-06T01:30:00.000Z',
  redeemed_at: null, redeemed_note: null, context: { landing: '/furnace' }
};
const map = { gift: 'gift', code: 'gift_code', value: 'gift_value', claimed: 'claimed', expires: 'expires', zip: 'zip', campaign: 'campaign', landing: 'landing', smsConsent: 'consent', property: 'property' };
const env = { MONDAY_API_TOKEN: 'test', MONDAY_BOARD_ID: '18436262982', MONDAY_CODE_STATUS_COLUMN: 'code_status', MONDAY_DIAL_COLUMNS: JSON.stringify(map) };

function capture(t: any, failDetails = false) {
  const calls: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); calls.push(body);
    if (body.query.includes('create_item')) return Response.json({ data: { create_item: { id: '123' } } });
    if (failDetails && body.query.includes('change_multiple')) return Response.json({ errors: [{ message: 'bad column' }] });
    return Response.json({ data: { change_multiple_column_values: { id: '123' }, create_update: { id: '456' } } });
  });
  return calls;
}

test('structured creation exposes gift, dates and attribution without inventing customer details', async t => {
  const calls = capture(t);
  await createDialItem(env, entry, gift, cfg);
  assert.equal(calls[0].variables.n, 'ARR-7K3P');
  const v = JSON.parse(calls[1].variables.c);
  assert.deepEqual(v.gift, { labels: ['$20 off any service'] });
  assert.equal(v.gift_code, 'ARR-7K3P');
  assert.equal(v.gift_value, 20);
  assert.deepEqual(v.claimed, { date: '2026-11-05' });
  assert.deepEqual(v.expires, { date: '2026-12-05' });
  assert.equal(v.campaign, 'fall');
  assert.equal(v.landing, '/furnace');
  assert.deepEqual(v.consent, { checked: 'false' });
  assert.equal(v.lead_source, 'google');
  assert.equal(v.zip, undefined);
  assert.equal(v.property, undefined);
  assert.deepEqual(v.code_status, { label: 'Issued' });
  assert.ok(!('assigned_to' in v) && !('next_follow_up' in v));
});

test('later customer details update structured columns while preserving the manual sales workflow', async t => {
  const calls = capture(t);
  await updateDialItem(env, '123', { ...entry, first_name: 'Maria', address: '1 Main St', zip: '60462', home: { yearBuilt: 1980 } }, gift, cfg);
  const v = JSON.parse(calls[0].variables.c);
  assert.equal(v.name, 'Maria');
  assert.equal(v.zip, '60462');
  assert.equal(v[MONDAY_COLUMNS.address], '1 Main St, 60462');
  assert.match(v.property.text, /built 1980/);
  assert.equal(v[MONDAY_COLUMNS.status], undefined);
  assert.equal(v.code_status, undefined, 'details must not undo a manual redemption');
});

test('admin sync keeps structured expiry and void status current without resetting follow-up status', async t => {
  const calls = capture(t);
  await syncDialItem(env, '123', { ...entry, voided_at: '2026-11-06T01:30:00Z', expires_at: '2027-01-02T01:00:00Z' }, gift, cfg);
  const v = JSON.parse(calls[0].variables.c);
  assert.deepEqual(v.expires, { date: '2027-01-01' });
  assert.deepEqual(v.code_status, { label: 'Void' });
  assert.equal(v[MONDAY_COLUMNS.status], undefined);
});

test('legacy mappings keep the existing item naming and missing structured mappings are optional', async t => {
  const calls = capture(t);
  await createDialItem({ MONDAY_API_TOKEN: 'test', MONDAY_BOARD_ID: '1' }, entry, gift, cfg);
  assert.equal(calls[0].variables.n, 'Comfort Dial ARR-7K3P: $20 off any service');
  assert.equal(JSON.parse(calls[1].variables.c).gift_code, undefined);
});

test('a rejected structured column retains the created lead and posts the full detail fallback', async t => {
  const calls = capture(t, true);
  const r = await createDialItem(env, entry, gift, cfg);
  assert.equal(r.itemId, '123');
  assert.match(r.detailsError!, /bad column/);
  assert.match(calls[2].variables.t, /COMFORT DIAL ARR-7K3P/);
});

test('explicit SMS opt-in is checked and absent attribution stays empty', async t => {
  const calls = capture(t);
  await createDialItem(env, { ...entry, sms_marketing: true, utm: null, page: null, context: null }, gift, cfg);
  const v = JSON.parse(calls[1].variables.c);
  assert.deepEqual(v.consent, { checked: 'true' });
  assert.equal(v.campaign, undefined);
  assert.equal(v.landing, undefined);
  assert.equal(v.lead_source, 'Comfort Dial');
});
