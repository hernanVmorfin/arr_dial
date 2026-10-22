import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryDb } from '../db-memory.ts';
import { supabaseDb } from '../db-supabase.ts';
import { addressKey } from '../address.ts';
import { parseSearch } from '../db.ts';
import { takeTurn, claimGift, status, type Cfg } from '../dial.ts';
import { liveConfig, forgetConfig, publicConfig } from '../config.ts';
import { memoryAuth } from './auth.ts';
import { mayCall } from './roles.ts';
import { makeCode } from '../rules.js';
import { readSession, signSession, sessionCookie, cookieValue } from './session.ts';
import {
  signIn, publishConfig, setDialEnabled, rollbackTo, codeAction, addAdmin, removeAdmin, changePassword, currentConfig,
  statsRange, cleanConfig, freeYears, setAdminRole, RESENDS_PER_DAY
} from './service.ts';

const builtIn = JSON.parse(readFileSync(new URL('../../../data/dial.json', import.meta.url), 'utf8'));
const OCT = new Date('2026-10-16T15:00:00Z');
const later = (m: number) => new Date(OCT.getTime() + m * 6e4);
const JASON = { email: 'jason@arrhvac.com', name: 'Jason', created_at: OCT.toISOString(), created_by: 'test' };
const PW = 'correct horse battery';

function setup() {
  forgetConfig();
  const db = memoryDb({ admins: [JASON] });
  const auth = memoryAuth({ [JASON.email]: PW, 'pricing@arrhvac.com': 'pricing-app-pass' });
  return { db, auth };
}
let n = 0;
const ipIn = () => ({ ip: `10.9.0.${++n}`, device: `dev-${n}-abcdefgh`, ipLimits: true });
async function win(db: ReturnType<typeof memoryDb>, cfg: Cfg, phone: string, when = OCT) {
  const t = await takeTurn(db, cfg, ipIn(), when, () => 0.1);
  if (!t.ok) throw new Error('turn');
  const c = await claimGift(db, cfg, { turnId: t.turn.id, phone, ip: `10.8.0.${++n}`, ipLimits: true, utm: { utm_source: 'facebook' } }, when);
  if (!c.ok || c.duplicate) throw new Error('claim');
  return c.entry;
}

/* ---------------- sign-in and sessions ---------------- */

test('sign-in: right password and on the list; wrong password; a Supabase user who is not an admin', async () => {
  const { db, auth } = setup();
  const ok = await signIn(db, auth, { email: ' Jason@ARRHVAC.com ', password: PW, ip: '1.1.1.1' }, OCT);
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.session.email, JASON.email);
  assert.equal(ok.session.name, 'Jason');
  assert.equal(ok.session.exp, OCT.getTime() + 12 * 36e5);
  const bad = await signIn(db, auth, { email: JASON.email, password: 'nope', ip: '1.1.1.1' }, OCT);
  assert.ok(!bad.ok && bad.status === 401);
  const outsider = await signIn(db, auth, { email: 'pricing@arrhvac.com', password: 'pricing-app-pass', ip: '1.1.1.2' }, OCT);
  assert.ok(!outsider.ok && outsider.status === 401, 'a valid Supabase login is not enough');
  assert.equal(db.auditRows.filter((r) => r.action === 'login').length, 1);
  assert.equal(db.auditRows.filter((r) => r.action === 'login_failed').length, 2);
});

test('sign-in: 8 failures pause that email and that connection for 15 minutes', async () => {
  const { db, auth } = setup();
  for (let i = 0; i < 8; i++) await signIn(db, auth, { email: JASON.email, password: `guess${i}`, ip: `2.2.2.${i}` }, OCT);
  const locked = await signIn(db, auth, { email: JASON.email, password: PW, ip: '3.3.3.3' }, later(1));
  assert.ok(!locked.ok && locked.status === 429, 'the right password waits too');
  assert.ok((await signIn(db, auth, { email: JASON.email, password: PW, ip: '3.3.3.3' }, later(16))).ok);
  for (let i = 0; i < 8; i++) await signIn(db, auth, { email: `nobody${i}@x.com`, password: 'x', ip: '4.4.4.4' }, later(20));
  const fromIp = await signIn(db, auth, { email: JASON.email, password: PW, ip: '4.4.4.4' }, later(21));
  assert.ok(!fromIp.ok && fromIp.status === 429);
});

test('session cookies: signed, tamper-proof, expire, and are scoped to the app', async () => {
  const s = { email: JASON.email, name: 'Jason', uid: 'u1', exp: OCT.getTime() + 1000 };
  const token = await signSession(s, 'secret-a');
  assert.deepEqual(await readSession(token, 'secret-a', OCT.getTime()), s);
  assert.equal(await readSession(token, 'secret-b', OCT.getTime()), null, 'another key');
  assert.equal(await readSession(token, 'secret-a', OCT.getTime() + 1000), null, 'expired');
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...s, email: 'evil@x.com' })).toString('base64url');
  assert.equal(await readSession(`${forged}.${sig}`, 'secret-a', OCT.getTime()), null, 'edited payload');
  assert.equal(await readSession(`${body}.`, 'secret-a', OCT.getTime()), null);
  const c = sessionCookie(token, '/dial/', true);
  assert.match(c, /^arrd_admin=.+; Path=\/dial\/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/);
  assert.match(sessionCookie(null, '/dial/', false), /Max-Age=0$/);
  assert.equal(cookieValue(`a=1; arrd_admin=${token}; b=2`), token);
});

/* ---------------- config ---------------- */

const edited = (cfg: Cfg, f: (c: Cfg) => void) => { const c = JSON.parse(JSON.stringify(cfg)); f(c); return c; };

test('publish: validates, lays out the dial, versions grow, and the live config follows', async () => {
  const { db } = setup();
  const cur = await currentConfig(db, builtIn);
  assert.equal(cur.version, 0);
  const next = edited(cur.config, (c) => { c.gifts.find((g) => g.id === 'svc20')!.weight = 40; c.gifts.find((g) => g.id === 'call')!.weight = 20; });
  const res = await publishConfig(db, builtIn, { config: next, baseVersion: 0, note: 'More free calls', by: JASON.email, ip: null }, OCT);
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.version, 1);
  assert.equal(res.config.zones.filter((z) => z.gift === 'call')[0].pct, 20, 'zones follow the odds');
  const live = await liveConfig(db, builtIn);
  assert.equal(live.version, 1);
  assert.equal(live.gifts.find((g) => g.id === 'call')!.weight, 20);
  assert.equal(db.auditRows.at(-1)!.action, 'publish');
  assert.equal(db.auditRows.at(-1)!.target, 'v1');

  const stale = await publishConfig(db, builtIn, { config: next, baseVersion: 0, by: JASON.email, ip: null }, OCT);
  assert.ok(!stale.ok && stale.status === 409, 'a second editor working from version 0 is refused');

  const broken = edited(next, (c) => { c.gifts[0].weight = 1; });
  const bad = await publishConfig(db, builtIn, { config: broken, baseVersion: 1, by: JASON.email, ip: null }, OCT);
  assert.ok(!bad.ok && bad.status === 400 && bad.errors!.some((e) => /add up to/.test(e)));
  assert.equal((await currentConfig(db, builtIn)).version, 1, 'nothing published');
});

test('publish: unknown fields are dropped and a new gift gets a slice', async () => {
  const { db } = setup();
  const cur = await currentConfig(db, builtIn);
  const next = edited(cur.config, (c: any) => {
    c.evil = '<script>';
    c.gifts.find((g: any) => g.id === 'svc20').weight = 35;
    c.gifts.push({ id: 'tune40', short: '$40 OFF TUNE-UP', name: '$40 off a tune-up', sub: 'Furnace or AC', weight: 10, value: 40, fill: '#14284e', ink: '#f9f7f8', big: '$40 OFF', small: 'TUNE-UP', codePrefix: 'tune40', seraLine: 'Comfort Dial $40 tune-up', extra: 1 });
  });
  const res = await publishConfig(db, builtIn, { config: next, baseVersion: 0, by: JASON.email, ip: null }, OCT);
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal((res.config as any).evil, undefined);
  assert.equal((res.config.gifts.at(-1) as any).extra, undefined);
  assert.equal(res.config.gifts.at(-1)!.codePrefix, 'TUNE40', 'prefixes are stored in capitals');
  assert.deepEqual(res.config.zones.at(-1), { gift: 'tune40', pct: 10, big: '$40 OFF', small: 'TUNE-UP' });
  assert.deepEqual(Object.keys(cleanConfig(builtIn)).sort(), Object.keys(builtIn).filter((k) => k !== '_note').sort(), 'the cleaner knows every field');
});

test('pause stops turns and resumes; the popup is told; holds already on screen can still be claimed', async () => {
  const { db } = setup();
  const before = await takeTurn(db, await liveConfig(db, builtIn), ipIn(), OCT, () => 0.1);
  assert.ok(before.ok);
  const p = await setDialEnabled(db, builtIn, { enabled: false, by: JASON.email, ip: null }, OCT);
  assert.ok(p.ok && p.version === 1);
  const paused = await liveConfig(db, builtIn);
  const t = await takeTurn(db, paused, ipIn(), OCT, () => 0.1);
  assert.ok(!t.ok && t.reason === 'paused' && t.status === 503);
  if (before.ok) {
    const c = await claimGift(db, paused, { turnId: before.turn.id, phone: '7085550111', ip: '9.9.9.9', ipLimits: true }, later(1));
    assert.ok(c.ok && !c.duplicate, 'the visitor holding a gift keeps it');
  }
  assert.equal(db.auditRows.at(-1)!.action, 'pause');
  const again = await setDialEnabled(db, builtIn, { enabled: false, by: JASON.email, ip: null }, OCT);
  assert.ok(again.ok && again.version === 1, 'pausing twice publishes nothing');
  assert.ok((await setDialEnabled(db, builtIn, { enabled: true, by: JASON.email, ip: null }, OCT)).ok);
  assert.ok((await takeTurn(db, await liveConfig(db, builtIn), ipIn(), OCT, () => 0.1)).ok);
});

test('turns record the config version that picked them; a switched-off free year leaves status and odds', async () => {
  const { db } = setup();
  const cur = await currentConfig(db, builtIn);
  const noMem = edited(cur.config, (c) => { c.gifts.find((g) => g.id === 'mem')!.active = false; c.gifts.find((g) => g.id === 'svc20')!.weight = 50; });
  const res = await publishConfig(db, builtIn, { config: noMem, baseVersion: 0, by: JASON.email, ip: null }, OCT);
  assert.ok(res.ok);
  const live = await liveConfig(db, builtIn);
  for (let i = 0; i < 30; i++) {
    const t = await takeTurn(db, live, ipIn(), OCT, () => 0.999);
    assert.ok(t.ok && t.gift.id !== 'mem' && t.turn.config_version === 1);
  }
  const st = await status(db, live, OCT);
  assert.deepEqual([st.membershipOpen, st.membershipsLeft, st.nextUnlock], [false, 0, null]);
  assert.ok(!publicConfig(live).gifts.some((g) => g.id === 'mem'), 'the popup never sees a gift that is off');
  const pub = publicConfig(live).gifts[0] as Record<string, unknown>;
  assert.equal(pub.expiresDays, live.expiresDays, 'each gift says how long its code lasts');
  assert.ok(!('seraLine' in pub) && !('codePrefix' in pub), 'internal fields stay home');
});

test('rollback publishes an old version again and keeps later gifts, switched off', async () => {
  const { db } = setup();
  const cur = await currentConfig(db, builtIn);
  const withTune = edited(cur.config, (c) => {
    c.gifts.find((g) => g.id === 'svc20')!.weight = 35;
    c.gifts.push({ id: 'tune40', short: '$40 OFF TUNE-UP', name: '$40 off a tune-up', sub: 'Furnace or AC', weight: 10, value: 40, fill: '#14284e', ink: '#f9f7f8', big: '$40 OFF', small: 'TUNE-UP', codePrefix: 'TUNE40', seraLine: 'Comfort Dial $40 tune-up' });
  });
  assert.ok((await publishConfig(db, builtIn, { config: withTune, baseVersion: 0, by: JASON.email, ip: null }, OCT)).ok);
  const back = await rollbackTo(db, builtIn, { version: 0, baseVersion: 1, by: JASON.email, ip: null }, OCT);
  assert.ok(back.ok);
  if (!back.ok) return;
  assert.equal(back.version, 2);
  assert.equal(back.config.gifts.find((g) => g.id === 'svc20')!.weight, 45);
  assert.equal(back.config.gifts.find((g) => g.id === 'tune40')!.active, false);
  assert.ok(!back.config.zones.some((z) => z.gift === 'tune40'));
  assert.equal(db.configs.find((c) => c.version === 2)!.note, 'Restored version 0');
});

test('rollback to a version from before code prefixes keeps today\'s prefixes and Sera lines', async () => {
  const { db } = setup();
  const old = JSON.parse(JSON.stringify(builtIn));
  for (const g of old.gifts) { delete g.codePrefix; delete g.seraLine; }
  db.configs.push({ version: 1, config: old, note: 'from before prefixes', created_by: 'test', created_at: OCT.toISOString() });
  assert.ok((await publishConfig(db, builtIn, { config: builtIn, baseVersion: 1, by: JASON.email, ip: null }, OCT)).ok, 'prefixes can be added to promos published without them');
  const back = await rollbackTo(db, builtIn, { version: 1, baseVersion: 2, by: JASON.email, ip: null }, OCT);
  assert.ok(back.ok);
  if (back.ok) assert.deepEqual(back.config.gifts.map((g) => [g.codePrefix, !!g.seraLine]), builtIn.gifts.map((g: any) => [g.codePrefix, true]));
});

/* ---------------- codes ---------------- */

test('code actions: redeem once, void needs a reason, restore, extend, and each one is on the audit trail', async () => {
  const { db } = setup();
  const cfg = await liveConfig(db, builtIn);
  const e = await win(db, cfg, '7085550201');
  const by = { by: JASON.email, ip: '5.5.5.5' };

  const noReason = await codeAction(db, { code: e.code, action: 'void', ...by }, OCT);
  assert.ok(!noReason.ok && noReason.status === 400);
  const v = await codeAction(db, { code: e.code.toLowerCase(), action: 'void', note: 'Duplicate household', ...by }, OCT);
  assert.ok(v.ok && v.entry.voided_at && v.entry.voided_note === 'Duplicate household (jason@arrhvac.com)');
  const redeemVoid = await codeAction(db, { code: e.code, action: 'redeem', ...by }, OCT);
  assert.ok(!redeemVoid.ok && redeemVoid.status === 409);
  assert.ok((await codeAction(db, { code: e.code, action: 'restore', ...by }, OCT)).ok);

  const ext = await codeAction(db, { code: e.code, action: 'extend', days: 14, ...by }, OCT);
  assert.ok(ext.ok);
  if (ext.ok) assert.equal(ext.entry.expires_at, new Date(new Date(e.expires_at).getTime() + 14 * 864e5).toISOString(), 'from the old expiry, not from today');

  const r = await codeAction(db, { code: e.code, action: 'redeem', note: 'Job 4411', ...by }, OCT);
  assert.ok(r.ok && r.entry.redeemed_note === 'Redeemed in the admin by jason@arrhvac.com: Job 4411');
  const twice = await codeAction(db, { code: e.code, action: 'redeem', ...by }, OCT);
  assert.ok(!twice.ok && twice.status === 409);
  assert.equal(await db.redeemByMondayItem('none', OCT, 'x'), null);

  const trail = await db.auditFor(e.code, 10);
  assert.deepEqual(trail.map((a) => a.action).sort(), ['extend', 'redeem', 'restore', 'void']);
  assert.ok(trail.every((a) => a.actor === JASON.email && a.ip === '5.5.5.5'));
});

test('code actions: an expired code can be extended back to life; resends are capped per day', async () => {
  const { db } = setup();
  const cfg = await liveConfig(db, builtIn);
  const e = await win(db, cfg, '7085550202');
  const after = new Date(new Date(e.expires_at).getTime() + 864e5);
  const r = await codeAction(db, { code: e.code, action: 'resend', by: JASON.email, ip: null }, after);
  assert.ok(!r.ok && r.status === 409, 'no texting an expired code');
  const x = await codeAction(db, { code: e.code, action: 'extend', days: 7, by: JASON.email, ip: null }, after);
  assert.ok(x.ok);
  if (x.ok) assert.equal(x.entry.expires_at, new Date(after.getTime() + 7 * 864e5).toISOString(), 'from today when it had run out');
  for (let i = 0; i < RESENDS_PER_DAY; i++) assert.ok((await codeAction(db, { code: e.code, action: 'resend', by: JASON.email, ip: null }, after)).ok);
  const capped = await codeAction(db, { code: e.code, action: 'resend', by: JASON.email, ip: null }, after);
  assert.ok(!capped.ok && capped.status === 429);
  const unknown = await codeAction(db, { code: 'ARR-YYYY', action: 'redeem', by: JASON.email, ip: null }, OCT);
  assert.ok(!unknown.ok && unknown.status === 404);
});

test('code lookup understands codes, phone fragments and names; filters by status and gift', async () => {
  const c = makeCode('SVC20'), off = c.slice(0, -1) + (c.at(-1) === 'A' ? 'C' : 'A');
  assert.deepEqual(parseSearch(c.toLowerCase()), { code: c });
  assert.deepEqual(parseSearch(c.replace('-', ' ')), { code: c });
  assert.deepEqual(parseSearch(off), { text: off, typo: off }, 'a failed check is still searched as text, and flagged');
  assert.deepEqual(parseSearch(c.slice(6)), { text: c.slice(6) }, 'the random part alone finds it inside the code');
  assert.deepEqual(parseSearch('arr-7k3p'), { code: 'ARR-7K3P' });
  assert.deepEqual(parseSearch('7K3P'), { code: 'ARR-7K3P' });
  assert.deepEqual(parseSearch('Ravinia'), { text: 'Ravinia' });
  assert.deepEqual(parseSearch('(708) 555-02'), { phone: '70855502' });
  assert.deepEqual(parseSearch('+1 708 555 0201'), { phone: '7085550201' });
  assert.deepEqual(parseSearch('Park'), { text: 'Park' });
  assert.deepEqual(parseSearch('14532 S. Ravinia, (x)'), { text: '14532 S. Ravinia x' });
  assert.equal(parseSearch(' '), null);

  const { db } = setup();
  const cfg = await liveConfig(db, builtIn);
  const a = await win(db, cfg, '7085550301', OCT);
  const b = await win(db, cfg, '7085550302', later(5));
  await db.updateEntry(b.id, { first_name: 'Maria', address: '8120 W 159th St' });
  await codeAction(db, { code: a.code, action: 'redeem', by: JASON.email, ip: null }, later(6));
  const now = later(10);
  assert.deepEqual((await db.searchEntries({ q: a.code, limit: 50, offset: 0, now })).rows.map((r) => r.code), [a.code]);
  assert.deepEqual((await db.searchEntries({ q: '555-030', limit: 50, offset: 0, now })).rows.map((r) => r.code), [b.code, a.code], 'newest first');
  assert.deepEqual((await db.searchEntries({ q: 'maria', limit: 50, offset: 0, now })).rows.map((r) => r.code), [b.code]);
  assert.deepEqual((await db.searchEntries({ q: '159th', limit: 50, offset: 0, now })).rows.map((r) => r.code), [b.code]);
  assert.deepEqual((await db.searchEntries({ status: 'redeemed', limit: 50, offset: 0, now })).rows.map((r) => r.code), [a.code]);
  assert.deepEqual((await db.searchEntries({ status: 'issued', limit: 50, offset: 0, now })).rows.map((r) => r.code), [b.code]);
  const page = await db.searchEntries({ limit: 1, offset: 1, now });
  assert.deepEqual([page.rows.length, page.total], [1, 2]);
});

test('code actions: a mistyped code says a character is off; a CSR redeems and texts again, nothing else', async () => {
  const { db } = setup();
  const cfg = await liveConfig(db, builtIn);
  const e = await win(db, cfg, '7085550203');
  const last = e.code.at(-1)!, other = last === 'A' ? 'C' : 'A';
  const typo = await codeAction(db, { code: e.code.slice(0, -1) + other, action: 'redeem', by: JASON.email, ip: null }, OCT);
  assert.ok(!typo.ok && typo.status === 400 && /One character in .* is off/.test(typo.error));
  const notCode = await codeAction(db, { code: 'hello', action: 'redeem', by: JASON.email, ip: null }, OCT);
  assert.ok(!notCode.ok && /Codes look like SVC20-7K3PK/.test(notCode.error));
  assert.ok((await codeAction(db, { code: e.code.replace('-', ' ').toLowerCase(), action: 'resend', by: 'dana@arrhvac.com', role: 'csr', ip: null }, OCT)).ok, 'typed loosely, still found');

  const csr = { by: 'dana@arrhvac.com', role: 'csr' as const, ip: null };
  for (const action of ['void', 'restore', 'extend']) {
    const r = await codeAction(db, { code: e.code, action, note: 'x', days: 7, ...csr }, OCT);
    assert.ok(!r.ok && r.status === 403, `a CSR can't ${action}`);
  }
  const after = new Date(new Date(e.expires_at).getTime() + 864e5);
  const late = await codeAction(db, { code: e.code, action: 'redeem', ...csr }, after);
  assert.ok(!late.ok && late.status === 409 && /Ask an admin to extend/.test(late.error), 'a CSR can\'t redeem an expired code');
  const r = await codeAction(db, { code: e.code, action: 'redeem', note: 'Job 5120', ...csr }, OCT);
  assert.ok(r.ok && r.entry.redeemed_note === 'Redeemed in the admin by dana@arrhvac.com: Job 5120');
});

test('roles: a CSR may make only the Codes tab\'s calls', () => {
  for (const [m, p] of [['GET', 'codes'], ['GET', 'code'], ['POST', 'code'], ['GET', 'config'], ['POST', 'logout'], ['POST', 'password']]) assert.ok(mayCall('csr', m, p), `${m} ${p}`);
  for (const [m, p] of [['POST', 'config'], ['POST', 'state'], ['POST', 'rollback'], ['GET', 'team'], ['POST', 'team'], ['PATCH', 'team'], ['GET', 'stats'], ['GET', 'versions'], ['GET', 'membership']]) assert.ok(!mayCall('csr', m, p), `${m} ${p}`);
  assert.ok(mayCall('admin', 'POST', 'config'));
});

/* ---------------- team ---------------- */

test('team: add with a temporary password, add someone who already has an account, remove, change your password', async () => {
  const { db, auth } = setup();
  const short = await addAdmin(db, auth, { email: 'csr@arrhvac.com', name: 'Dana', password: 'short', by: JASON.email, ip: null }, OCT);
  assert.ok(!short.ok && short.status === 400);
  const added = await addAdmin(db, auth, { email: 'CSR@arrhvac.com', name: 'Dana', password: 'temporary-pass-1', by: JASON.email, ip: null }, OCT);
  assert.deepEqual(added, { ok: true, existingAccount: false });
  assert.ok((await signIn(db, auth, { email: 'csr@arrhvac.com', password: 'temporary-pass-1', ip: null }, OCT)).ok);

  const existing = await addAdmin(db, auth, { email: 'pricing@arrhvac.com', name: 'Pat', password: 'whatever-long-1', by: JASON.email, ip: null }, OCT);
  assert.deepEqual(existing, { ok: true, existingAccount: true });
  assert.ok((await signIn(db, auth, { email: 'pricing@arrhvac.com', password: 'pricing-app-pass', ip: null }, OCT)).ok, 'their own password is untouched');
  const dup = await addAdmin(db, auth, { email: 'csr@arrhvac.com', name: 'Dana', password: 'temporary-pass-1', by: JASON.email, ip: null }, OCT);
  assert.ok(!dup.ok && dup.status === 409);

  const self = await removeAdmin(db, { email: JASON.email, by: JASON.email, ip: null }, OCT);
  assert.ok(!self.ok);
  assert.ok((await removeAdmin(db, { email: 'csr@arrhvac.com', by: JASON.email, ip: null }, OCT)).ok);
  const gone = await signIn(db, auth, { email: 'csr@arrhvac.com', password: 'temporary-pass-1', ip: null }, OCT);
  assert.ok(!gone.ok, 'removed from the list means no way in, even with the right password');

  const asCsr = await addAdmin(db, auth, { email: 'dana@arrhvac.com', name: 'Dana', password: 'temporary-pass-2', role: 'csr', by: JASON.email, ip: null }, OCT);
  assert.ok(asCsr.ok);
  assert.equal((await db.admin('dana@arrhvac.com'))!.role, 'csr');
  const badRole = await addAdmin(db, auth, { email: 'x@arrhvac.com', name: 'X', password: 'temporary-pass-3', role: 'owner', by: JASON.email, ip: null }, OCT);
  assert.ok(!badRole.ok && badRole.status === 400);
  assert.ok((await setAdminRole(db, { email: 'dana@arrhvac.com', role: 'admin', by: JASON.email, ip: null }, OCT)).ok);
  assert.equal((await db.admin('dana@arrhvac.com'))!.role, 'admin');
  const own = await setAdminRole(db, { email: JASON.email, role: 'csr', by: JASON.email, ip: null }, OCT);
  assert.ok(!own.ok && own.status === 400, 'nobody demotes themselves');
  assert.deepEqual(db.auditRows.filter((a) => a.action === 'role').map((a) => a.detail), [{ from: 'csr', to: 'admin' }]);

  const session = { email: JASON.email, name: 'Jason', uid: JASON.email, exp: 0 };
  const wrong = await changePassword(db, auth, { session, current: 'nope', next: 'a-brand-new-password', ip: null }, OCT);
  assert.ok(!wrong.ok);
  assert.ok((await changePassword(db, auth, { session, current: PW, next: 'a-brand-new-password', ip: null }, OCT)).ok);
  assert.ok((await signIn(db, auth, { email: JASON.email, password: 'a-brand-new-password', ip: null }, OCT)).ok);
});

/* ---------------- results ---------------- */

test('results: turns, players, claims, redemptions, by gift, by Chicago day, by source', async () => {
  const { db } = setup();
  const cfg = await liveConfig(db, builtIn);
  const a = await win(db, cfg, '7085550401', OCT);
  await win(db, cfg, '7085550402', new Date('2026-10-17T04:30:00Z'));   // 11:30pm Oct 16 in Chicago
  await takeTurn(db, cfg, { ip: '1.1.1.1', device: 'repeat-device-1', ipLimits: true }, OCT, () => 0.5);
  await takeTurn(db, cfg, { ip: '1.1.1.1', device: 'repeat-device-1', ipLimits: true }, OCT, () => 0.5);
  await codeAction(db, { code: a.code, action: 'redeem', by: JASON.email, ip: null }, new Date('2026-10-18T15:00:00Z'));
  const r = statsRange({ from: '2026-10-16', to: '2026-10-18' });
  const s = await db.stats(r.since, r.until);
  assert.equal(s.turns, 4);
  assert.equal(s.players, 3);
  assert.equal(s.claims, 2);
  assert.equal(s.redeemed, 1);
  assert.deepEqual(s.versions, [0]);
  assert.deepEqual(s.byGift, [{ gift: 'duct50', turns: 2, claims: 0, redeemed: 0 }, { gift: 'svc20', turns: 2, claims: 2, redeemed: 1 }]);
  assert.deepEqual(s.byDay, [{ day: '2026-10-16', turns: 4, claims: 2, redeemed: 0 }, { day: '2026-10-18', turns: 0, claims: 0, redeemed: 1 }]);
  assert.deepEqual(s.sources, [{ source: 'facebook', claims: 2, redeemed: 1 }]);
  const one = await db.stats(statsRange({ from: '2026-10-17', to: '2026-10-17' }).since, statsRange({ from: '2026-10-17', to: '2026-10-17' }).until);
  assert.equal(one.turns, 0, 'the 11:30pm turn counts on the 16th');
});

test('results ranges are whole Chicago days', () => {
  const now = new Date('2026-10-19T17:00:00Z');
  const w = statsRange({ range: '7d' }, now);
  assert.deepEqual([w.from, w.to], ['2026-10-13', '2026-10-19']);
  assert.equal(w.since.toISOString(), '2026-10-13T05:00:00.000Z');
  assert.equal(w.until.toISOString(), '2026-10-20T05:00:00.000Z');
  assert.deepEqual([statsRange({ range: 'today' }, now).from, statsRange({ range: '30d' }, now).from], ['2026-10-19', '2026-09-20']);
  assert.equal(statsRange({ from: '2026-10-05', to: '2026-10-01' }, now).from, '2026-10-13', 'a backwards custom range falls back');
});

/* ---------------- free-year schedule ---------------- */

const HOME = { street: '14532 S Ravinia Ave', zip: '60462' };
const NOV = new Date('2026-11-10T15:00:00Z');
const months = (c: Cfg, m: string[]) => edited(c, (x) => { x.membership.months = m; });
function withHome() {
  forgetConfig();
  return memoryDb({ admins: [JASON], properties: { [addressKey(HOME.street, HOME.zip)]: 'cook:27101000000000' } });
}
async function winFreeYear(db: ReturnType<typeof memoryDb>, cfg: Cfg, phone: string, when: Date) {
  const t = await takeTurn(db, cfg, ipIn(), when, () => 0.97);
  if (!t.ok || t.gift.id !== 'mem') throw new Error('turn');
  const c = await claimGift(db, cfg, { turnId: t.turn.id, phone, ip: `10.8.0.${++n}`, ipLimits: true, ...HOME }, when);
  if (!c.ok || c.duplicate) throw new Error('claim');
  return c.entry;
}

test('free-year schedule: months publish in calendar order, and the line under the dial and the turns follow', async () => {
  const { db } = setup();
  const cur = await currentConfig(db, builtIn);
  const res = await publishConfig(db, builtIn, { config: months(cur.config, ['2027-03', '2026-10', '2026-12', '2027-01', '2027-02']), baseVersion: 0, by: JASON.email, ip: null }, OCT);
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.deepEqual(res.config.membership.months, ['2026-10', '2026-12', '2027-01', '2027-02', '2027-03'], 'November dropped, March added, stored in order');
  const live = await liveConfig(db, builtIn);
  const st = await status(db, live, NOV);
  assert.deepEqual([st.inSeason, st.membershipOpen, st.membershipsLeft, st.nextUnlock], [false, false, 4, '2026-12']);
  for (let i = 0; i < 20; i++) {
    const t = await takeTurn(db, live, ipIn(), NOV, () => 0.97);
    assert.ok(t.ok && t.gift.id !== 'mem', 'no free year in a month off the schedule');
  }
  const dec = await takeTurn(db, live, ipIn(), new Date('2026-12-02T15:00:00Z'), () => 0.97);
  assert.ok(dec.ok && dec.gift.id === 'mem');
});

test('free-year schedule: a won month stays listed, an ended one can\'t be added, and a restore keeps to both', async () => {
  const db = withHome();
  const cur = await currentConfig(db, builtIn);
  await winFreeYear(db, cur.config, '7085550501', OCT);
  const by = { by: JASON.email, ip: null };
  const drop = await publishConfig(db, builtIn, { config: months(cur.config, ['2026-11', '2026-12', '2027-01', '2027-02']), baseVersion: 0, ...by }, NOV);
  assert.ok(!drop.ok && drop.status === 400 && /October 2026's free year was won/.test(drop.error));
  const past = await publishConfig(db, builtIn, { config: months(cur.config, ['2026-09', ...cur.config.membership.months]), baseVersion: 0, ...by }, NOV);
  assert.ok(!past.ok && /September 2026 has ended/.test(past.error));
  assert.ok((await publishConfig(db, builtIn, { config: months(cur.config, ['2026-10', '2026-11', '2027-01', '2027-02', '2027-03']), baseVersion: 0, ...by }, NOV)).ok);

  // Restoring version 0 in January: December ended off the schedule, so it doesn't come back.
  const back = await rollbackTo(db, builtIn, { version: 0, baseVersion: 1, ...by }, new Date('2027-01-10T15:00:00Z'));
  assert.ok(back.ok);
  if (back.ok) assert.deepEqual(back.config.membership.months, ['2026-10', '2026-11', '2027-01', '2027-02']);
});

test('free-year schedule: restoring a version from before a month was won keeps that month', async () => {
  const db = withHome();
  const cur = await currentConfig(db, builtIn);
  const by = { by: JASON.email, ip: null };
  assert.ok((await publishConfig(db, builtIn, { config: months(cur.config, ['2026-11', '2026-12']), baseVersion: 0, ...by }, new Date('2026-09-20T15:00:00Z'))).ok);
  assert.ok((await publishConfig(db, builtIn, { config: months(cur.config, ['2026-10', '2026-11', '2026-12']), baseVersion: 1, ...by }, new Date('2026-09-21T15:00:00Z'))).ok);
  await winFreeYear(db, await liveConfig(db, builtIn), '7085550502', OCT);
  const back = await rollbackTo(db, builtIn, { version: 1, baseVersion: 2, ...by }, new Date('2026-12-05T15:00:00Z'));
  assert.ok(back.ok);
  if (back.ok) assert.deepEqual(back.config.membership.months, ['2026-10', '2026-11', '2026-12']);
});

test('free-year schedule: each month shows who won it with the code, a hold on screen, or free again', async () => {
  const db = withHome();
  const cfg = await liveConfig(db, builtIn);
  const e = await winFreeYear(db, cfg, '7085550601', OCT);
  const t = await takeTurn(db, cfg, ipIn(), NOV, () => 0.97);
  assert.ok(t.ok && t.gift.id === 'mem');
  const a = await freeYears(db, cfg, new Date(NOV.getTime() + 2 * 6e4));
  assert.equal(a.month, '2026-11');
  assert.deepEqual(a.rows.map((r) => [r.month, r.state]), [['2026-10', 'won'], ['2026-11', 'held']]);
  assert.equal(a.rows[0].entry!.code, e.code);
  assert.equal(a.rows[0].entry!.giftName, 'Free year of membership ($299 value)');
  assert.equal(a.rows[1].entry, null);
  const b = await freeYears(db, cfg, new Date(NOV.getTime() + 11 * 6e4));
  assert.equal(b.rows[1].state, 'free', 'a hold that ran out frees itself');
});

test('free-year schedule: the Supabase store asks for every month and the free-year codes', async () => {
  const urls: string[] = [];
  const fake = (async (u: URL) => { urls.push(String(u)); return new Response('[]', { status: 200 }); }) as unknown as typeof fetch;
  const sb = supabaseDb({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SECRET_KEY: 'sb_secret_test' }, fake);
  assert.deepEqual([await sb.allMemberships(), await sb.membershipEntries()], [[], []]);
  assert.deepEqual(urls, [
    'https://x.supabase.co/rest/v1/comfort_dial_memberships?select=*&order=mem_month.asc',
    'https://x.supabase.co/rest/v1/comfort_dial_entries?select=*&mem_month=not.is.null&order=mem_month.asc'
  ]);
});
