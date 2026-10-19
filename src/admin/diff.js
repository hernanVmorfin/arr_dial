/* What changed between two configs, in plain words: shown before publishing and on each version in History. */
import { monthName } from '../lib/rules.js';

const pct = (n) => `${Number((+n).toFixed(2))}%`;
const list = (a) => (a || []).join(', ') || 'none';

const SETTINGS = [
  ['enabled', 'Dial', (v) => (v ? 'on' : 'paused')],
  ['popup.split', 'Visitors who get the popup', (v) => `${Math.round(v * 100)}%`],
  ['popup.delayMs', 'Popup delay', (v) => `${v / 1000} s`],
  ['popup.snoozeDays', 'Snooze after it was seen', (v) => `${v} days`],
  ['popup.tab', 'Side tab', (v) => (v ? 'on' : 'off')],
  ['popup.excludePaths', 'Pages without the popup', list],
  ['holdMinutes', 'Hold time', (v) => `${v} min`],
  ['expiresDays', 'Codes expire after', (v) => `${v} days`],
  ['limits.turnsPerDevicePerDay', 'Turns per device per day', String],
  ['limits.turnsPerIpPerDay', 'Turns per connection per day', String],
  ['limits.claimsPerIpPerDay', 'Claims per connection per day', String],
  ['phone', 'Phone', String],
  ['bookUrl', 'Book online link', String],
  ['zipPrefixes', 'Service area ZIPs', list],
  ['season', 'Season name', String],
  ['rulesFinal', 'Official rules', (v) => (v ? 'final' : 'draft')]
];
const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function diffConfigs(a, b) {
  if (!a) return ['First published version'];
  const out = [];
  const before = Object.fromEntries(a.gifts.map((g) => [g.id, g]));
  for (const g of b.gifts) {
    const p = before[g.id];
    const on = g.active !== false;
    if (!p) { out.push(`New promo: ${g.name}${on ? ` at ${pct(g.weight)}` : ' (off)'}`); continue; }
    const was = p.active !== false;
    if (was && !on) { out.push(`Switched off: ${g.name}`); continue; }
    if (!was && on) out.push(`Switched on: ${g.name} at ${pct(g.weight)}`);
    else if (on && p.weight !== g.weight) out.push(`${g.name}: odds ${pct(p.weight)} → ${pct(g.weight)}`);
    const words = [];
    if (p.name !== g.name) words.push(`renamed from "${p.name}"`);
    if (p.value !== g.value) words.push(`value $${p.value} → $${g.value}`);
    if (p.sub !== g.sub) words.push('description');
    if (p.short !== g.short) words.push('short name');
    if ((p.big ?? '') !== (g.big ?? '') || (p.small ?? '') !== (g.small ?? '')) words.push('dial label');
    if (p.fill !== g.fill || p.ink !== g.ink) words.push('colours');
    if (words.length) out.push(`${g.name}: ${words.join(', ')}`);
  }
  const order = (c) => c.zones.map((z) => z.gift).join();
  const kept = (c, ids) => c.zones.filter((z) => ids.has(z.gift)).map((z) => z.gift).join();
  const both = new Set(a.zones.map((z) => z.gift).filter((id) => b.zones.some((z) => z.gift === id)));
  if (order(a) !== order(b) && kept(a, both) !== kept(b, both)) out.push('Dial order changed');
  for (const [path, label, f] of SETTINGS) {
    const x = get(a, path), y = get(b, path);
    if (!same(x, y)) out.push(`${label}: ${x == null ? '–' : f(x)} → ${y == null ? '–' : f(y)}`);
  }
  const was = get(a, 'membership.months') || [], now = get(b, 'membership.months') || [];
  const added = now.filter((m) => !was.includes(m)), removed = was.filter((m) => !now.includes(m));
  const words = [added.length && `added ${added.map((m) => monthName(m)).join(', ')}`, removed.length && `removed ${removed.map((m) => monthName(m)).join(', ')}`];
  if (added.length || removed.length) out.push(`Free-year months: ${words.filter(Boolean).join('; ')}`);
  return out;
}
