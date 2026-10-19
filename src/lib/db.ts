/* Storage behind the dial. Two implementations of one interface:
 *   supabaseDb: production, Supabase PostgREST with the server-only secret key (lib/db-supabase.ts)
 *   memoryDb:   tests and local dev with DIAL_MEMORY_DB=1 (lib/db-memory.ts), same semantics, no network
 * Every rule that must hold under races (one free year per month, one gift per phone) is a constraint or a
 * compare-and-set in the Supabase implementation, mirrored here so the service logic is tested against it. */

/* config_version: the published config the gift was picked under (0 = the built-in data/dial.json). Left out of the
 * insert while it is 0, so the dial keeps working before the admin migration has run. */
export type Turn = {
  id: string; gift: string; mem_month: string | null; ip: string | null; device: string | null;
  created_at: string; held_until: string; claimed_at: string | null; entry_id: string | null; config_version?: number | null;
};

export type Entry = {
  id: string; code: string; turn_id: string | null; phone: string; gift: string; mem_month: string | null;
  first_name: string | null; address: string | null; zip: string | null; household_key: string | null;
  sms_marketing: boolean; utm: Record<string, string> | null; page: string | null; ip: string | null;
  monday_item_id: string | null; created_at: string; expires_at: string; redeemed_at: string | null; redeemed_note: string | null;
  voided_at?: string | null; voided_note?: string | null;
};

export type NewEntry = Omit<Entry, 'id' | 'created_at' | 'redeemed_at' | 'redeemed_note' | 'monday_item_id' | 'voided_at' | 'voided_note'> & { created_at: string };

export type Membership = { mem_month: string; turn_id: string; held_until: string; claimed_at: string | null };

export type InsertResult =
  | { ok: true; entry: Entry }
  | { ok: false; conflict: 'code' | 'phone' | 'turn' | 'membership' | 'other'; detail?: string };

export interface DialDb {
  countTurns(since: Date, by: { ip?: string; device?: string }): Promise<number>;
  countEntries(since: Date, ip: string): Promise<number>;
  membership(month: string): Promise<Membership | null>;
  claimedMonths(): Promise<string[]>;
  /** Take the month's free year for this turn: succeeds if nobody holds it, or the last hold expired unclaimed. */
  holdMembership(month: string, turnId: string, until: Date, now: Date): Promise<boolean>;
  /** Give back an unclaimed hold (the visitor turned out to be a repeat phone, or the turn insert failed). */
  releaseMembership(month: string, turnId: string, now: Date): Promise<void>;
  /** Claim the month's free year for this turn, only if this turn still holds it. */
  claimMembership(month: string, turnId: string, now: Date): Promise<boolean>;
  /** Undo claimMembership when the entry insert fails afterwards. */
  unclaimMembership(month: string, turnId: string, now: Date): Promise<void>;
  insertTurn(t: Turn): Promise<void>;
  getTurn(id: string): Promise<Turn | null>;
  markTurnClaimed(id: string, entryId: string, now: Date): Promise<void>;
  entryByPhone(phone: string): Promise<Entry | null>;
  entryByTurn(turnId: string): Promise<Entry | null>;
  membershipEntryForHousehold(householdKey: string): Promise<Entry | null>;
  insertEntry(e: NewEntry): Promise<InsertResult>;
  updateEntry(id: string, patch: Partial<Entry>): Promise<Entry | null>;
  /** The county parcel key for a normalized address (Supabase property_addresses), or null. */
  propertyKey(normalizedKey: string): Promise<string | null>;
  redeemByMondayItem(itemId: string, now: Date, note: string): Promise<Entry | null>;
}

/* ---------------- the admin's storage (supabase/migrations/20261019_comfort_dial_admin.sql) ---------------- */

/** One published config. Versions only ever grow; a rollback publishes an old config again as a new version. */
export type ConfigVersion = { version: number; config: unknown; note: string | null; created_by: string; created_at: string };
export type Admin = { email: string; name: string; created_at: string; created_by: string | null };
export type AuditRow = {
  at: string; actor: string; action: string; target: string | null; detail: Record<string, unknown> | null; ip: string | null;
};

/** issued: usable now · redeemed · expired: past expires_at unused · void: cancelled in the admin */
export type CodeStatus = 'issued' | 'redeemed' | 'expired' | 'void';
export type EntrySearch = { q?: string; status?: CodeStatus; gift?: string; limit: number; offset: number; now: Date };

/** Results for a period. turns/players/byGift.turns count turns made in the period; claims/redeemed/sources count
 *  codes issued in the period (redeemed = of those, how many were used, whenever). byDay.redeemed counts redemptions
 *  that happened that day. Days are Chicago dates. */
export type Stats = {
  turns: number; players: number; claims: number; redeemed: number; voided: number; reminders: number;
  versions: number[];
  byGift: { gift: string; turns: number; claims: number; redeemed: number }[];
  byDay: { day: string; turns: number; claims: number; redeemed: number }[];
  sources: { source: string; claims: number; redeemed: number }[];
};

export interface AdminDb {
  latestConfig(): Promise<ConfigVersion | null>;
  configVersion(version: number): Promise<ConfigVersion | null>;
  configVersions(limit: number): Promise<ConfigVersion[]>;
  /** Insert a new version. 'conflict' when that version number was taken: someone else published first. */
  insertConfig(row: ConfigVersion): Promise<'ok' | 'conflict'>;

  admin(email: string): Promise<Admin | null>;
  admins(): Promise<Admin[]>;
  addAdmin(a: Admin): Promise<'ok' | 'exists'>;
  removeAdmin(email: string): Promise<void>;

  audit(row: AuditRow): Promise<void>;
  auditCount(action: string, since: Date, by: { ip?: string; target?: string }): Promise<number>;
  auditFor(target: string, limit: number): Promise<AuditRow[]>;
  /** Most recent successful sign-in per admin email. */
  lastLogins(): Promise<Record<string, string>>;

  entryByCode(code: string): Promise<Entry | null>;
  entryById(id: string): Promise<Entry | null>;
  searchEntries(s: EntrySearch): Promise<{ rows: Entry[]; total: number }>;
  /** Compare-and-set: only a code that is neither redeemed nor void. */
  redeemEntry(id: string, now: Date, note: string): Promise<Entry | null>;
  stats(since: Date, until: Date): Promise<Stats>;
}

/** What the code-lookup box was given: a code (with or without ARR-), part of a phone number, or a name or street. */
export function parseSearch(raw: string | undefined): { code: string } | { phone: string } | { text: string } | null {
  const q = String(raw || '').trim().slice(0, 60);
  if (!q) return null;
  // ARR-7K3P, ARR7K3P, or a bare 7K3P (a bare one needs a letter and a digit, so "PARK" stays a street search)
  const c = /^ARR-?([ACDEFGHJKMNPQRTUVWXY34679]{4})$/i.exec(q) || (/\d/.test(q) && /[a-z]/i.test(q) ? /^([ACDEFGHJKMNPQRTUVWXY34679]{4})$/i.exec(q) : null);
  if (c) return { code: `ARR-${c[1].toUpperCase()}` };
  if (!/[a-z]/i.test(q)) {
    const d = q.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    if (d.length >= 4) return { phone: d };
  }
  const text = q.replace(/[^A-Za-z0-9 .'-]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length >= 2 ? { text } : null;
}

export const codeStatus = (e: Entry, now: Date): CodeStatus =>
  e.voided_at ? 'void' : e.redeemed_at ? 'redeemed' : new Date(e.expires_at) <= now ? 'expired' : 'issued';
