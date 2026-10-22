/* The admin's actions, on top of DialDb & AdminDb. Pure service logic like lib/dial.ts: no I/O except through the
 * store and the PasswordAuth it's given, so the tests run it against memoryDb and memoryAuth. Texts, Monday and
 * Klaviyo happen in the routes (lib/fanout.ts) after these succeed.
 *
 *   signIn         Supabase Auth checks the password, comfort_dial_admins decides who's an admin. 8 failures in
 *                  15 minutes from one connection, or for one email, pause sign-in for that connection or email.
 *   publishConfig  validate, lay out the dial, insert as version N+1. Two people editing at once: the second publish
 *                  names the version it started from, finds a newer one, and is refused rather than overwriting.
 *   codeAction     redeem · void · restore · extend · resend, each written to the audit trail with who did it. A CSR
 *                  may only redeem and resend (lib/admin/roles.ts).
 *   freeYears      each month's free year as stored (won, held, free), for the Settings tab's schedule.
 *   team           add (as an admin or a CSR), remove, change someone's role, change your own password. */
import { addDays, chicagoDay, chicagoMidnight, chicagoMonth, checkCode, readCode, layoutZones, validateConfig } from '../rules.js';
import { CSR_CODE_ACTIONS, roleOf, type Role } from './roles.ts';
import { codeStatus } from '../db.ts';
import { forgetConfig } from '../config.ts';
import type { AdminDb, DialDb, Entry } from '../db.ts';
import type { Cfg } from '../dial.ts';
import type { PasswordAuth } from './auth.ts';
import { SESSION_HOURS, type Session } from './session.ts';
import { codeView, type CodeView } from './view.ts';

type Store = DialDb & AdminDb;
export type Fail = { ok: false; status: number; error: string; errors?: string[]; warnings?: string[] };
const fail = (status: number, error: string, extra: Partial<Fail> = {}): Fail => ({ ok: false, status, error, ...extra });

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
export const MIN_PASSWORD = 12;
const THROTTLE = { tries: 8, minutes: 15 };

/* ---------------- sign-in ---------------- */

export async function signIn(db: Store, auth: PasswordAuth, input: { email: unknown; password: unknown; ip: string | null }, now = new Date()):
  Promise<{ ok: true; session: Session } | Fail> {
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (!EMAIL.test(email) || !password || password.length > 200) return fail(400, 'Enter your email and password.');
  const since = new Date(now.getTime() - THROTTLE.minutes * 6e4);
  const tooMany = (await db.auditCount('login_failed', since, { target: email })) >= THROTTLE.tries
    || (!!input.ip && (await db.auditCount('login_failed', since, { ip: input.ip })) >= THROTTLE.tries);
  if (tooMany) return fail(429, `Too many tries. Wait ${THROTTLE.minutes} minutes and try again.`);

  const user = await auth.signIn(email, password);
  const admin = user ? await db.admin(user.email) : null;
  if (!user || !admin) {
    await db.audit({ at: now.toISOString(), actor: email, action: 'login_failed', target: email, detail: user ? { reason: 'not an admin' } : null, ip: input.ip });
    return fail(401, 'That email and password don\'t match an admin account.');
  }
  await db.audit({ at: now.toISOString(), actor: admin.email, action: 'login', target: admin.email, detail: null, ip: input.ip });
  return { ok: true, session: { email: admin.email, name: admin.name, uid: user.id, exp: now.getTime() + SESSION_HOURS * 36e5 } };
}

/* ---------------- config ---------------- */

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : v);
const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : v);

/** Only the fields the dial knows, strings trimmed, free-year months in calendar order. Anything else in a request
 *  is dropped, not stored. */
export function cleanConfig(raw: any): Cfg {
  const r = raw && typeof raw === 'object' ? raw : {};
  const L = r.limits || {}, P = r.popup || {}, M = r.membership || {};
  const months = strs(M.months);
  const gifts = (Array.isArray(r.gifts) ? r.gifts : []).map((g: any) => {
    const out: Record<string, unknown> = {
      id: s(g?.id), short: s(g?.short), name: s(g?.name), sub: s(g?.sub), weight: g?.weight, value: g?.value,
      fill: s(g?.fill), ink: s(g?.ink), active: g?.active !== false,
      codePrefix: typeof g?.codePrefix === 'string' ? g.codePrefix.trim().toUpperCase() : g?.codePrefix, seraLine: s(g?.seraLine)
    };
    if (g?.expiresDays != null && g.expiresDays !== '') out.expiresDays = g.expiresDays;   // blank: the config's
    if (typeof g?.big === 'string') out.big = g.big.trim();
    if (typeof g?.small === 'string') out.small = g.small.trim();
    return out;
  });
  const zones = (Array.isArray(r.zones) ? r.zones : []).map((z: any) => ({ gift: s(z?.gift), pct: z?.pct, big: s(z?.big) ?? '', small: s(z?.small) ?? '' }));
  return {
    enabled: r.enabled, season: s(r.season), phone: s(r.phone), bookUrl: s(r.bookUrl), rulesFinal: r.rulesFinal,
    expiresDays: r.expiresDays, holdMinutes: r.holdMinutes, zipPrefixes: strs(r.zipPrefixes),
    limits: { turnsPerDevicePerDay: L.turnsPerDevicePerDay, turnsPerIpPerDay: L.turnsPerIpPerDay, claimsPerIpPerDay: L.claimsPerIpPerDay },
    popup: { split: P.split, delayMs: P.delayMs, snoozeDays: P.snoozeDays, excludePaths: strs(P.excludePaths), tab: P.tab },
    membership: { giftId: s(M.giftId), months: Array.isArray(months) ? [...months].sort() : months },
    gifts, zones
  } as Cfg;
}

export async function currentConfig(db: AdminDb, builtIn: unknown): Promise<{ version: number; config: Cfg; created_by: string | null; created_at: string | null; note: string | null }> {
  const row = await db.latestConfig();
  if (!row) return { version: 0, config: cleanConfig(builtIn), created_by: null, created_at: null, note: 'Built-in starting config (data/dial.json)' };
  return { version: row.version, config: row.config as Cfg, created_by: row.created_by, created_at: row.created_at, note: row.note };
}

export type PublishInput = { config: unknown; baseVersion: unknown; note?: unknown; by: string; ip: string | null; action?: 'publish' | 'pause' | 'resume' | 'rollback' };
export type PublishOk = { ok: true; version: number; config: Cfg; warnings: string[] };

export async function publishConfig(db: Store, builtIn: unknown, input: PublishInput, now = new Date()): Promise<PublishOk | Fail> {
  const cur = await currentConfig(db, builtIn);
  if (input.baseVersion !== cur.version) {
    return fail(409, `Someone published version ${cur.version} while you were editing. Reload to see it, then make your change again.`);
  }
  const cfg = cleanConfig(input.config);
  cfg.zones = layoutZones(cfg.zones, cfg.gifts);
  const { errors, warnings } = validateConfig(cfg, cur.config, { month: chicagoMonth(now), claimed: await db.claimedMonths() });
  if (errors.length) return fail(400, errors[0], { errors, warnings });
  const version = cur.version + 1;
  const note = String(input.note || '').trim().slice(0, 300) || null;
  if ((await db.insertConfig({ version, config: cfg, note, created_by: input.by, created_at: now.toISOString() })) === 'conflict') {
    return fail(409, `Someone published version ${version} a moment ago. Reload to see it, then make your change again.`);
  }
  forgetConfig();
  await db.audit({ at: now.toISOString(), actor: input.by, action: input.action || 'publish', target: `v${version}`, detail: { note, odds: oddsSummary(cfg), enabled: cfg.enabled }, ip: input.ip });
  return { ok: true, version, config: cfg, warnings };
}

const oddsSummary = (cfg: Cfg) => Object.fromEntries(cfg.gifts.filter((g) => g.active !== false).map((g) => [g.id, g.weight]));

/** Pause or resume: the live config with only `enabled` changed, published as a new version. */
export async function setDialEnabled(db: Store, builtIn: unknown, input: { enabled: unknown; by: string; ip: string | null }, now = new Date()): Promise<PublishOk | Fail> {
  if (typeof input.enabled !== 'boolean') return fail(400, 'Say whether the dial should be on or off.');
  const cur = await currentConfig(db, builtIn);
  if (cur.config.enabled === input.enabled) return { ok: true, version: cur.version, config: cur.config, warnings: [] };
  return publishConfig(db, builtIn, {
    config: { ...cur.config, enabled: input.enabled }, baseVersion: cur.version, by: input.by, ip: input.ip,
    note: input.enabled ? 'Dial switched back on' : 'Dial paused', action: input.enabled ? 'resume' : 'pause'
  }, now);
}

/** Publish an old version again. Gifts added since stay in the config, switched off, so their codes still resolve.
 *  A version from before code prefixes and Sera lines takes them from the live config. Free-year months won since
 *  stay on the schedule, because the official rules print them. */
export async function rollbackTo(db: Store, builtIn: unknown, input: { version: unknown; baseVersion: unknown; by: string; ip: string | null }, now = new Date()): Promise<PublishOk | Fail> {
  const v = Number(input.version);
  if (!Number.isInteger(v) || v < 0) return fail(400, 'Pick a version to restore.');
  const old = v === 0 ? cleanConfig(builtIn) : ((await db.configVersion(v))?.config as Cfg | undefined);
  if (!old) return fail(404, `Version ${v} doesn't exist.`);
  const cur = await currentConfig(db, builtIn);
  const gifts = old.gifts.map((g) => {
    const live = cur.config.gifts.find((x) => x.id === g.id);
    return live ? { ...g, codePrefix: live.codePrefix ?? g.codePrefix, seraLine: g.seraLine || live.seraLine } : g;
  });
  for (const g of cur.config.gifts) if (!gifts.some((x) => x.id === g.id)) gifts.push({ ...g, active: false });
  // The old free-year schedule, less months that have ended since (they can't be added back), plus months won since.
  const listed = cur.config.membership.months, month = chicagoMonth(now);
  const won = (await db.claimedMonths()).filter((m) => listed.includes(m));
  const membership = { ...old.membership, months: [...new Set([...old.membership.months.filter((m) => m >= month || listed.includes(m)), ...won])] };
  return publishConfig(db, builtIn, { config: { ...old, gifts, membership }, baseVersion: input.baseVersion, by: input.by, ip: input.ip, note: `Restored version ${v}`, action: 'rollback' }, now);
}

/* ---------------- codes ---------------- */

export type CodeActionName = 'redeem' | 'void' | 'restore' | 'extend' | 'resend';
export type CodeActionInput = { code: unknown; action: unknown; note?: unknown; days?: unknown; by: string; role?: Role; ip: string | null };
export const RESENDS_PER_DAY = 3;

/** Why a typed code can't be looked up, or null when it can. */
export function codeProblem(code: string | null): string | null {
  if (!code) return 'That isn\'t a dial code. Codes look like SVC20-7K3PK.';
  if (checkCode(code) === 'typo') return `One character in ${code} is off. Read the code back with the customer.`;
  return null;
}

export async function codeAction(db: Store, input: CodeActionInput, now = new Date()): Promise<{ ok: true; entry: Entry; action: CodeActionName } | Fail> {
  const code = readCode(input.code);
  const problem = codeProblem(code);
  if (problem || !code) return fail(400, problem!);
  const action = input.action as CodeActionName;
  if (!['redeem', 'void', 'restore', 'extend', 'resend'].includes(action)) return fail(400, 'Unknown action.');
  if (roleOf(input.role) === 'csr' && !CSR_CODE_ACTIONS.includes(action)) return fail(403, 'Ask an admin to void, restore or extend a code.');
  const entry = await db.entryByCode(code);
  if (!entry) return fail(404, `No code ${code}.`);
  const note = String(input.note || '').trim().slice(0, 300);
  const st = codeStatus(entry, now);
  const at = now.toISOString();
  let out: Entry | null = entry;
  let detail: Record<string, unknown> = note ? { note } : {};

  if (action === 'redeem') {
    if (st === 'void') return fail(409, 'This code was voided. Restore it first if it should be used.');
    if (st === 'redeemed') return fail(409, 'This code was already used.');
    if (st === 'expired' && roleOf(input.role) === 'csr') return fail(409, 'This code has expired. Ask an admin to extend it first.');
    out = await db.redeemEntry(entry.id, now, `Redeemed in the admin by ${input.by}${note ? `: ${note}` : ''}`);
    if (!out) return fail(409, 'This code was used or voided a moment ago. Reload it.');
  } else if (action === 'void') {
    if (!note) return fail(400, 'Say why the code is being voided.');
    if (st === 'void') return fail(409, 'This code is already void.');
    if (st === 'redeemed') return fail(409, 'This code was already used, so there is nothing to void.');
    out = await db.updateEntry(entry.id, { voided_at: at, voided_note: `${note} (${input.by})` });
  } else if (action === 'restore') {
    if (st !== 'void') return fail(409, 'Only a void code can be restored.');
    out = await db.updateEntry(entry.id, { voided_at: null, voided_note: null });
  } else if (action === 'extend') {
    const days = Number(input.days);
    if (!Number.isInteger(days) || days < 1 || days > 90) return fail(400, 'Extend by 1 to 90 days.');
    if (st === 'void' || st === 'redeemed') return fail(409, `A ${st === 'void' ? 'void' : 'used'} code can't be extended.`);
    const from = Math.max(now.getTime(), new Date(entry.expires_at).getTime());
    const expires = new Date(from + days * 864e5).toISOString();
    out = await db.updateEntry(entry.id, { expires_at: expires });
    detail = { ...detail, days, from: entry.expires_at, to: expires };
  } else if (action === 'resend') {
    if (st !== 'issued') return fail(409, 'Only a code that can still be used can be texted again.');
    if ((await db.auditCount('resend', new Date(now.getTime() - 864e5), { target: code })) >= RESENDS_PER_DAY) {
      return fail(429, `This code was texted ${RESENDS_PER_DAY} times today already.`);
    }
  }
  if (!out) return fail(404, `No code ${code}.`);
  await db.audit({ at, actor: input.by, action, target: code, detail: Object.keys(detail).length ? detail : null, ip: input.ip });
  return { ok: true, entry: out, action };
}

/* ---------------- free-year schedule ---------------- */

/** won: claimed, with the code it went to · held: on someone's claim screen until held_until · free: a hold that ran
 *  out unclaimed, so the month is open again */
export type FreeYearState = 'won' | 'held' | 'free';
export type FreeYearRow = { month: string; state: FreeYearState; held_until: string; claimed_at: string | null; entry: CodeView | null };

/** Each month's free year as the database has it, for the Settings tab. `month` is this Chicago month. */
export async function freeYears(db: Store, cfg: Cfg, now = new Date()): Promise<{ month: string; rows: FreeYearRow[] }> {
  const [rows, entries] = await Promise.all([db.allMemberships(), db.membershipEntries()]);
  return {
    month: chicagoMonth(now),
    rows: rows.map((m) => {
      const e = m.claimed_at ? entries.find((x) => x.mem_month === m.mem_month && x.turn_id === m.turn_id) || entries.find((x) => x.mem_month === m.mem_month) : null;
      const state: FreeYearState = m.claimed_at ? 'won' : new Date(m.held_until) >= now ? 'held' : 'free';
      return { month: m.mem_month, state, held_until: m.held_until, claimed_at: m.claimed_at, entry: e ? codeView(e, cfg, now) : null };
    })
  };
}

/* ---------------- team ---------------- */

export async function addAdmin(db: Store, auth: PasswordAuth, input: { email: unknown; name: unknown; password: unknown; role?: unknown; by: string; ip: string | null }, now = new Date()):
  Promise<{ ok: true; existingAccount: boolean } | Fail> {
  const email = String(input.email || '').trim().toLowerCase();
  const name = String(input.name || '').trim();
  const password = String(input.password || '');
  if (!EMAIL.test(email)) return fail(400, 'Enter a valid email.');
  if (!name || name.length > 60) return fail(400, 'Enter their name (up to 60 characters).');
  if (input.role !== undefined && input.role !== 'admin' && input.role !== 'csr') return fail(400, 'Pick Admin or CSR.');
  const role = roleOf(input.role);
  if (password.length < MIN_PASSWORD || password.length > 200) return fail(400, `The temporary password needs at least ${MIN_PASSWORD} characters.`);
  if (await db.admin(email)) return fail(409, `${email} is already on the team.`);
  const made = await auth.createUser(email, password);
  if ((await db.addAdmin({ email, name, role, created_at: now.toISOString(), created_by: input.by })) === 'exists') return fail(409, `${email} is already on the team.`);
  await db.audit({ at: now.toISOString(), actor: input.by, action: 'admin_add', target: email, detail: { name, role, existingAccount: made === 'exists' }, ip: input.ip });
  return { ok: true, existingAccount: made === 'exists' };
}

/** Make someone an admin or a CSR. Not yourself: that keeps at least one admin who can undo it. */
export async function setAdminRole(db: Store, input: { email: unknown; role: unknown; by: string; ip: string | null }, now = new Date()): Promise<{ ok: true } | Fail> {
  const email = String(input.email || '').trim().toLowerCase();
  if (input.role !== 'admin' && input.role !== 'csr') return fail(400, 'Pick Admin or CSR.');
  if (email === input.by) return fail(400, 'You can\'t change your own role. Ask another admin.');
  const a = await db.admin(email);
  if (!a) return fail(404, `${email} isn't on the team.`);
  const from = roleOf(a.role);
  if (from === input.role) return { ok: true };
  await db.setAdminRole(email, input.role);
  await db.audit({ at: now.toISOString(), actor: input.by, action: 'role', target: email, detail: { from, to: input.role }, ip: input.ip });
  return { ok: true };
}

export async function removeAdmin(db: Store, input: { email: unknown; by: string; ip: string | null }, now = new Date()): Promise<{ ok: true } | Fail> {
  const email = String(input.email || '').trim().toLowerCase();
  if (email === input.by) return fail(400, 'You can\'t remove yourself. Ask another admin.');
  if (!(await db.admin(email))) return fail(404, `${email} isn't on the team.`);
  await db.removeAdmin(email);
  await db.audit({ at: now.toISOString(), actor: input.by, action: 'admin_remove', target: email, detail: null, ip: input.ip });
  return { ok: true };
}

export async function changePassword(db: Store, auth: PasswordAuth, input: { session: Session; current: unknown; next: unknown; ip: string | null }, now = new Date()): Promise<{ ok: true } | Fail> {
  const current = String(input.current || ''), next = String(input.next || '');
  if (next.length < MIN_PASSWORD || next.length > 200) return fail(400, `The new password needs at least ${MIN_PASSWORD} characters.`);
  if (next === current) return fail(400, 'The new password is the same as the current one.');
  const user = await auth.signIn(input.session.email, current);
  if (!user) return fail(400, 'Your current password is wrong.');
  await auth.setPassword(user.id, next);
  await db.audit({ at: now.toISOString(), actor: input.session.email, action: 'password', target: input.session.email, detail: null, ip: input.ip });
  return { ok: true };
}

/* ---------------- results ---------------- */

export const RANGES = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All time' } as const;
export type RangeKey = keyof typeof RANGES;

/** A results period in Chicago days. `from`/`to` (YYYY-MM-DD, inclusive) win over a preset. */
export function statsRange(q: { range?: string | null; from?: string | null; to?: string | null }, now = new Date()): { since: Date; until: Date; from: string; to: string } {
  const today = chicagoDay(now);
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (q.from && day.test(q.from) && q.to && day.test(q.to) && q.from <= q.to) {
    return { since: chicagoMidnight(q.from), until: chicagoMidnight(addDays(q.to, 1)), from: q.from, to: q.to };
  }
  const back = q.range === 'today' ? 0 : q.range === '30d' ? 29 : q.range === 'all' ? null : 6;
  const from = back === null ? '2026-01-01' : addDays(today, -back);
  return { since: chicagoMidnight(from), until: chicagoMidnight(addDays(today, 1)), from, to: today };
}
