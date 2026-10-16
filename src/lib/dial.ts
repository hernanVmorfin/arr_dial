/* Comfort Dial service logic. The server decides every gift; the browser only animates the needle to the answer.
 *
 *   status   the line under the dial (is this month's free year still up?)
 *   turn     pick a gift by the published odds and hold it for `holdMinutes`. A free year is held for this turn
 *            alone, so the countdown on screen is real: nobody else can take it while it runs.
 *   claim    the visitor gives a mobile number (and, for a free year, a home address matched to county records).
 *            One gift per phone. Returns the code.
 *   details  optional name + address after the claim, so the CSR can book faster.
 *   redeem   the Monday "Code status → Redeemed" webhook marks the code used.
 *
 * Storage is the DialDb interface (lib/db.ts). Nothing here does I/O except through it. */
import {
  chicagoMonth, inSeason, membershipsLeft, nextMembershipMonth, pickGift, makeCode, normPhone, cleanFirstName,
  validateAddress, expiresAt, holdUntil, dayAgo, isUuid
} from './rules.js';
import { addressKey } from './address.ts';
import type { DialDb, Entry, Turn } from './db.ts';

/** The shape of data/dial.json. (Typed by hand so this module never imports JSON and runs under plain Node tests.) */
export type Gift = { id: string; short: string; name: string; sub: string; weight: number; value: number; fill: string; ink: string };
export type Cfg = {
  season: string; phone: string; bookUrl: string; rulesFinal: boolean; expiresDays: number; holdMinutes: number; zipPrefixes: string[];
  limits: { turnsPerDevicePerDay: number; turnsPerIpPerDay: number; claimsPerIpPerDay: number };
  membership: { giftId: string; months: string[] };
  gifts: Gift[];
  zones: { gift: string; pct: number; big: string; small: string }[];
};
export const giftById = (cfg: Cfg, id: string) => cfg.gifts.find((g) => g.id === id)!;

/** Seconds of slack after the countdown hits zero, for a slow network on the claim tap. */
const CLAIM_GRACE_MS = 60_000;

export type Fail = { ok: false; status: number; error: string; field?: string; reason?: string };
const fail = (status: number, error: string, extra: Partial<Fail> = {}): Fail => ({ ok: false, status, error, ...extra });

export async function status(db: DialDb, cfg: Cfg, now = new Date()) {
  const month = chicagoMonth(now);
  const claimed = await db.claimedMonths();
  return {
    month,
    membershipOpen: inSeason(cfg, month) && !claimed.includes(month),
    membershipsLeft: membershipsLeft(cfg, month, claimed),
    membershipsTotal: cfg.membership.months.length,
    nextUnlock: nextMembershipMonth(cfg, month)
  };
}

export type TurnInput = { ip: string | null; device: string | null; ipLimits: boolean };
export type TurnOk = { ok: true; turn: Turn; gift: Gift };

export async function takeTurn(db: DialDb, cfg: Cfg, input: TurnInput, now = new Date(), rand?: () => number): Promise<TurnOk | Fail> {
  const since = dayAgo(now);
  const limitMsg = `That's all the turns for today. Call ${cfg.phone} and we'll take care of you.`;
  if (input.device && (await db.countTurns(since, { device: input.device })) >= cfg.limits.turnsPerDevicePerDay) return fail(429, limitMsg, { reason: 'limit' });
  if (input.ipLimits && input.ip && (await db.countTurns(since, { ip: input.ip })) >= cfg.limits.turnsPerIpPerDay) return fail(429, limitMsg, { reason: 'limit' });

  const month = chicagoMonth(now);
  const id = crypto.randomUUID();
  const until = holdUntil(now, cfg.holdMinutes);
  const MEM = cfg.membership.giftId;

  // In play when the month is in season and nobody has claimed it or holds it right now.
  let available = false;
  if (inSeason(cfg, month)) {
    const m = await db.membership(month);
    available = !m || (!m.claimed_at && new Date(m.held_until) < now);
  }
  let gift = pickGift(cfg, available, rand) as Gift;
  let memMonth: string | null = null;
  if (gift.id === MEM) {
    if (await db.holdMembership(month, id, until, now)) memMonth = month;
    else gift = pickGift(cfg, false, rand) as Gift;   // someone took the hold a moment ago
  }

  const turn: Turn = {
    id, gift: gift.id, mem_month: memMonth, ip: input.ip, device: input.device,
    created_at: now.toISOString(), held_until: until.toISOString(), claimed_at: null, entry_id: null
  };
  try { await db.insertTurn(turn); }
  catch (e) { if (memMonth) await db.releaseMembership(memMonth, id, now).catch(() => {}); throw e; }
  return { ok: true, turn, gift };
}

export type ClaimInput = {
  turnId: unknown; phone: unknown; street?: unknown; zip?: unknown; reminders?: unknown;
  utm?: unknown; page?: unknown; ip: string | null; ipLimits: boolean;
};
/** fresh: a new win (texts, Monday, Klaviyo go out). duplicate: this phone already has a gift (nothing is revealed). */
export type ClaimOk = { ok: true; entry: Entry; gift: Gift; fresh: boolean; duplicate: false } | { ok: true; duplicate: true };

export async function claimGift(db: DialDb, cfg: Cfg, input: ClaimInput, now = new Date()): Promise<ClaimOk | Fail> {
  const turnId = String(input.turnId || '');
  if (!isUuid(turnId)) return fail(400, 'Turn the dial first.', { reason: 'no_turn' });
  const turn = await db.getTurn(turnId);
  if (!turn) return fail(404, 'We couldn\'t find that turn. Turn the dial again.', { reason: 'no_turn' });

  // The same claim sent twice (double tap, retry) gets the same answer.
  if (turn.entry_id) {
    const e = await db.entryByTurn(turnId);
    if (e) return { ok: true, entry: e, gift: giftById(cfg, e.gift), fresh: false, duplicate: false };
  }

  const phone = normPhone(input.phone);
  if (!phone) return fail(400, 'Enter a 10-digit mobile number. Your code is texted there.', { field: 'phone' });
  if (now.getTime() > new Date(turn.held_until).getTime() + CLAIM_GRACE_MS) {
    return fail(410, `Your ${cfg.holdMinutes}-minute hold ran out. Turn again for a new gift.`, { reason: 'expired' });
  }

  const gift = giftById(cfg, turn.gift);
  const isMem = gift.id === cfg.membership.giftId;
  let household: string | null = null, address: string | null = null, zip: string | null = null;
  if (isMem) {
    const v = validateAddress({ street: input.street, zip: input.zip }, cfg);
    if (!v.ok) return fail(400, v.error, { field: v.field });
    const pk = await db.propertyKey(addressKey(v.data.street, v.data.zip));
    if (!pk) return fail(400, `We couldn't match that address to a home in county records. Check the house number and street, or call ${cfg.phone}.`, { field: 'street' });
    household = `pk:${pk}`; address = v.data.street; zip = v.data.zip;
  }

  const release = async () => { if (turn.mem_month) await db.releaseMembership(turn.mem_month, turn.id, now).catch(() => {}); };
  if (await db.entryByPhone(phone)) { await release(); return { ok: true, duplicate: true }; }
  if (input.ipLimits && input.ip && (await db.countEntries(dayAgo(now), input.ip)) >= cfg.limits.claimsPerIpPerDay) {
    return fail(429, `That's a lot of gifts from one spot today. Call ${cfg.phone} and we'll help.`, { reason: 'limit' });
  }

  if (isMem) {
    if (await db.membershipEntryForHousehold(household!)) {
      await release();
      return fail(409, 'This home already won a free year from the dial, so this one goes back in the pot. Turn again for another gift.', { reason: 'household' });
    }
    if (!turn.mem_month || !(await db.claimMembership(turn.mem_month, turn.id, now))) {
      return fail(409, 'This month\'s free year was just claimed. Turn again for another gift.', { reason: 'expired' });
    }
  }

  const utm = input.utm && typeof input.utm === 'object' ? cleanUtm(input.utm as Record<string, unknown>) : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await db.insertEntry({
      code: makeCode(), turn_id: turn.id, phone, gift: gift.id, mem_month: isMem ? turn.mem_month : null,
      first_name: null, address, zip, household_key: household, sms_marketing: input.reminders === true,
      utm, page: input.page ? String(input.page).slice(0, 300) : null, ip: input.ip,
      created_at: now.toISOString(), expires_at: expiresAt(now, cfg.expiresDays).toISOString()
    });
    if (res.ok) {
      await db.markTurnClaimed(turn.id, res.entry.id, now);
      return { ok: true, entry: res.entry, gift, fresh: true, duplicate: false };
    }
    if (res.conflict === 'code') continue;
    if (res.conflict === 'turn') {   // the same claim landed a moment ago: it owns the free year, leave it claimed
      const e = await db.entryByTurn(turn.id);
      if (e) return { ok: true, entry: e, gift: giftById(cfg, e.gift), fresh: false, duplicate: false };
    }
    if (isMem && turn.mem_month) await db.unclaimMembership(turn.mem_month, turn.id, now).catch(() => {});
    if (res.conflict === 'phone') return { ok: true, duplicate: true };   // same phone, a moment ago
    if (res.conflict === 'membership') return fail(409, 'This month\'s free year was just claimed. Turn again for another gift.', { reason: 'expired' });
    throw new Error(`claim conflict ${res.conflict} ${res.detail || ''}`);
  }
  throw new Error('could not issue a unique code');
}

export type DetailsInput = { turnId: unknown; firstName?: unknown; street?: unknown; zip?: unknown };

export async function addDetails(db: DialDb, cfg: Cfg, input: DetailsInput): Promise<{ ok: true; entry: Entry } | Fail> {
  const turnId = String(input.turnId || '');
  if (!isUuid(turnId)) return fail(400, 'Claim your gift first.');
  const entry = await db.entryByTurn(turnId);
  if (!entry) return fail(404, 'Claim your gift first.');
  const rawName = String(input.firstName || '').trim();
  const first = rawName ? cleanFirstName(rawName) : null;
  if (rawName && !first) return fail(400, 'Enter just your first name.', { field: 'firstName' });
  const patch: Partial<Entry> = { first_name: first || entry.first_name };
  if (entry.gift !== cfg.membership.giftId) {   // a free-year winner's address is already locked to their home
    const v = validateAddress({ street: input.street, zip: input.zip }, cfg);
    if (!v.ok) return fail(400, v.error, { field: v.field });
    patch.address = v.data.street; patch.zip = v.data.zip;
  }
  const updated = await db.updateEntry(entry.id, patch);
  return updated ? { ok: true, entry: updated } : fail(404, 'Claim your gift first.');
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
function cleanUtm(u: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) if (typeof u[k] === 'string' && u[k]) out[k] = String(u[k]).slice(0, 120);
  return Object.keys(out).length ? out : null;
}
