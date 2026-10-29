import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Cfg } from './dial.ts';
import type { Entry } from './db.ts';
import { itemName, mondayColumns, pasteBlock, parseRedeemedWebhook, MONDAY_COLUMNS } from './monday.ts';
import { codeText } from './podium.ts';
import { wonEvent, redeemedEvent, smsSubscribeJob, profileImport, METRIC_WON } from './klaviyo.ts';
import { addressKey } from './address.ts';
import { envVar } from './env.ts';

const cfg: Cfg = JSON.parse(readFileSync(new URL('../../data/dial.json', import.meta.url), 'utf8'));
const gift = cfg.gifts.find((g) => g.id === 'svc20')!;
const entry: Entry = {
  id: 'e1', code: 'SVC20-7K3PK', turn_id: 't1', phone: '7085550142', gift: 'svc20', mem_month: null, first_name: null,
  address: null, zip: null, household_key: null, sms_marketing: true, utm: { utm_source: 'facebook', utm_campaign: 'fall' },
  page: 'https://www.alwaysreadyrepair.com/', ip: '1.2.3.4', monday_item_id: null,
  created_at: '2026-10-16T15:00:00.000Z', expires_at: '2026-11-15T15:00:00.000Z', redeemed_at: null, redeemed_note: null
};

test('Monday: the code is in the item name and the paste block tells the CSR what to do', () => {
  assert.equal(itemName(entry, gift), 'Comfort Dial SVC20-7K3PK: $20 off any service');
  assert.equal(itemName({ ...entry, first_name: 'Maria' }, gift), 'Maria · Comfort Dial SVC20-7K3PK: $20 off any service');
  const p = pasteBlock(entry, gift, cfg);
  assert.match(p, /COMFORT DIAL SVC20-7K3PK/);
  assert.match(p, /\(708\) 555-0142/);
  assert.match(p, /Expires: November 15, 2026/);
  assert.match(p, /reminders yes/);
  assert.match(p, /UTM: source=facebook · campaign=fall/);
  assert.match(p, /set Code status to Redeemed/);
});

test('Monday: only the old contact columns go in create_item; the code status column is optional', () => {
  const { core, details } = mondayColumns(entry, gift, cfg);
  assert.deepEqual(Object.keys(core).sort(), [MONDAY_COLUMNS.phone, MONDAY_COLUMNS.status].sort());
  assert.deepEqual(core[MONDAY_COLUMNS.phone], { phone: '7085550142', countryShortName: 'US' });
  assert.ok(!('color_code' in details));
  const withStatus = mondayColumns({ ...entry, address: '14532 S Ravinia Ave', zip: '60462' }, gift, cfg, 'color_code');
  assert.deepEqual(withStatus.details.color_code, { label: 'Issued' });
  assert.equal(withStatus.core[MONDAY_COLUMNS.address], '14532 S Ravinia Ave, 60462');
});

test('Monday webhook: challenge, redeemed, and everything else ignored', () => {
  assert.deepEqual(parseRedeemedWebhook({ challenge: 'abc' }, 'color_code'), { challenge: 'abc' });
  const ev = (columnId: string, text: string) => ({ event: { type: 'update_column_value', pulseId: 987, columnId, value: { label: { index: 1, text } } } });
  assert.deepEqual(parseRedeemedWebhook(ev('color_code', 'Redeemed'), 'color_code'), { itemId: '987' });
  assert.equal(parseRedeemedWebhook(ev('color_code', 'Issued'), 'color_code'), null);
  assert.equal(parseRedeemedWebhook(ev('other_col', 'Redeemed'), 'color_code'), null);
  assert.equal(parseRedeemedWebhook(ev('color_code', 'Redeemed'), undefined), null);
});

test('Podium: fixed copy with the code, gift and date', () => {
  const t = codeText(entry, gift, cfg);
  assert.equal(t, 'Always Ready Repair: your Comfort Dial gift is $20 off any service. Code SVC20-7K3PK, good through November 15. Call or text (708) 671-0813 to book and give the code.');
  assert.ok(t.length <= 320);
});

test('Klaviyo: won event carries what the reminder flow prints, keyed on the code', () => {
  const ev = wonEvent(entry, gift, cfg) as any;
  const a = ev.data.attributes;
  assert.equal(a.metric.data.attributes.name, METRIC_WON);
  assert.equal(a.unique_id, 'SVC20-7K3PK');
  assert.equal(a.profile.data.attributes.phone_number, '+17085550142');
  assert.equal(a.properties.expires_on, 'November 15');
  assert.equal(a.properties.gift_short, '$20 OFF');
  assert.equal(a.properties.utm_source, 'facebook');
  const r = redeemedEvent(entry, gift, new Date('2026-10-20T00:00:00Z')) as any;
  assert.equal(r.data.attributes.unique_id, 'SVC20-7K3PK-redeemed');
});

test('Klaviyo: SMS subscription only names a list when one is configured', () => {
  const job = smsSubscribeJob(entry) as any;
  assert.equal(job.data.attributes.profiles.data[0].attributes.subscriptions.sms.marketing.consent, 'SUBSCRIBED');
  assert.ok(!job.data.relationships);
  assert.equal((smsSubscribeJob(entry, 'L1') as any).data.relationships.list.data.id, 'L1');
  const prof = profileImport({ ...entry, first_name: 'Maria', address: '1 Main St', zip: '60462' }) as any;
  assert.equal(prof.data.attributes.first_name, 'Maria');
  assert.equal(prof.data.attributes.location.zip, '60462');
});

test('address key matches the pricing app normalizer', () => {
  assert.equal(addressKey('14532 South Ravinia Avenue', '60462'), '14532 S RAVINIA AVE|60462');
  assert.equal(addressKey('14532 S. Ravinia Ave.', '60462'), '14532 S RAVINIA AVE|60462');
  assert.equal(addressKey('8120 W 159th Street Apt 2', '60462'), '8120 W 159TH ST 2|60462');
});

test('env names are read case-insensitively', () => {
  assert.equal(envVar({ supabase_url: 'x' }, 'SUPABASE_URL'), 'x');
  assert.equal(envVar({ SUPABASE_URL: '' }, 'SUPABASE_URL'), undefined);
});
