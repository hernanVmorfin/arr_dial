/* Storage behind the dial. Two implementations of one interface:
 *   supabaseDb: production, Supabase PostgREST with the server-only secret key (lib/db-supabase.ts)
 *   memoryDb:   tests and local dev with DIAL_MEMORY_DB=1 (lib/db-memory.ts), same semantics, no network
 * Every rule that must hold under races (one free year per month, one gift per phone) is a constraint or a
 * compare-and-set in the Supabase implementation, mirrored here so the service logic is tested against it. */

export type Turn = {
  id: string; gift: string; mem_month: string | null; ip: string | null; device: string | null;
  created_at: string; held_until: string; claimed_at: string | null; entry_id: string | null;
};

export type Entry = {
  id: string; code: string; turn_id: string | null; phone: string; gift: string; mem_month: string | null;
  first_name: string | null; address: string | null; zip: string | null; household_key: string | null;
  sms_marketing: boolean; utm: Record<string, string> | null; page: string | null; ip: string | null;
  monday_item_id: string | null; created_at: string; expires_at: string; redeemed_at: string | null; redeemed_note: string | null;
};

export type NewEntry = Omit<Entry, 'id' | 'created_at' | 'redeemed_at' | 'redeemed_note' | 'monday_item_id'> & { created_at: string };

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
