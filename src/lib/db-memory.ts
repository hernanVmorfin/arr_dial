/* In-memory DialDb for tests and local dev (DIAL_MEMORY_DB=1). Mirrors the Supabase constraints and
 * compare-and-set updates, so tests of the service logic exercise the same rules production enforces. */
import type { DialDb, Entry, InsertResult, Membership, NewEntry, Turn } from './db.ts';

export function memoryDb(seed: { properties?: Record<string, string> } = {}): DialDb & { turns: Turn[]; entries: Entry[]; memberships: Membership[] } {
  const turns: Turn[] = [];
  const entries: Entry[] = [];
  const memberships: Membership[] = [];
  const properties = seed.properties || {};
  const after = (iso: string, since: Date) => new Date(iso) >= since;

  return {
    turns, entries, memberships,
    async countTurns(since, by) {
      return turns.filter((t) => after(t.created_at, since) && (by.ip ? t.ip === by.ip : true) && (by.device ? t.device === by.device : true)).length;
    },
    async countEntries(since, ip) { return entries.filter((e) => e.ip === ip && after(e.created_at, since)).length; },
    async membership(month) { return memberships.find((m) => m.mem_month === month) || null; },
    async claimedMonths() { return memberships.filter((m) => m.claimed_at).map((m) => m.mem_month); },
    async holdMembership(month, turnId, until, now) {
      const m = memberships.find((x) => x.mem_month === month);
      if (!m) { memberships.push({ mem_month: month, turn_id: turnId, held_until: until.toISOString(), claimed_at: null }); return true; }
      if (m.claimed_at || new Date(m.held_until) >= now) return false;
      m.turn_id = turnId; m.held_until = until.toISOString();
      return true;
    },
    async releaseMembership(month, turnId, now) {
      const m = memberships.find((x) => x.mem_month === month && x.turn_id === turnId && !x.claimed_at);
      if (m) m.held_until = now.toISOString();
    },
    async claimMembership(month, turnId, now) {
      const m = memberships.find((x) => x.mem_month === month && x.turn_id === turnId && !x.claimed_at);
      if (!m) return false;
      m.claimed_at = now.toISOString();
      return true;
    },
    async unclaimMembership(month, turnId, now) {
      const m = memberships.find((x) => x.mem_month === month && x.turn_id === turnId);
      if (m) { m.claimed_at = null; m.held_until = now.toISOString(); }
    },
    async insertTurn(t) { turns.push({ ...t }); },
    async getTurn(id) { return turns.find((t) => t.id === id) || null; },
    async markTurnClaimed(id, entryId, now) {
      const t = turns.find((x) => x.id === id);
      if (t) { t.claimed_at = now.toISOString(); t.entry_id = entryId; }
    },
    async entryByPhone(phone) { return entries.find((e) => e.phone === phone) || null; },
    async entryByTurn(turnId) { return entries.find((e) => e.turn_id === turnId) || null; },
    async membershipEntryForHousehold(hk) { return entries.find((e) => e.gift === 'mem' && e.household_key === hk) || null; },
    async insertEntry(e: NewEntry): Promise<InsertResult> {
      if (entries.some((x) => x.code === e.code)) return { ok: false, conflict: 'code' };
      if (entries.some((x) => x.phone === e.phone)) return { ok: false, conflict: 'phone' };
      if (e.turn_id && entries.some((x) => x.turn_id === e.turn_id)) return { ok: false, conflict: 'turn' };
      if (e.gift === 'mem' && entries.some((x) => x.gift === 'mem' && (x.mem_month === e.mem_month || x.household_key === e.household_key))) return { ok: false, conflict: 'membership' };
      const entry: Entry = { ...e, id: crypto.randomUUID(), monday_item_id: null, redeemed_at: null, redeemed_note: null };
      entries.push(entry);
      return { ok: true, entry: { ...entry } };
    },
    async updateEntry(id, patch) {
      const e = entries.find((x) => x.id === id);
      if (!e) return null;
      Object.assign(e, patch);
      return { ...e };
    },
    async propertyKey(key) { return properties[key] || null; },
    async redeemByMondayItem(itemId, now, note) {
      const e = entries.find((x) => x.monday_item_id === itemId && !x.redeemed_at);
      if (!e) return null;
      e.redeemed_at = now.toISOString(); e.redeemed_note = note;
      return { ...e };
    }
  };
}
