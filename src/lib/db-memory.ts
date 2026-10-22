/* In-memory DialDb for tests and local dev (DIAL_MEMORY_DB=1). Mirrors the Supabase constraints and
 * compare-and-set updates, so tests of the service logic exercise the same rules production enforces.
 * The admin half (AdminDb) mirrors the tables and the comfort_dial_stats function in the admin migration. */
import { codeStatus, parseSearch } from './db.ts';
import type { Admin, AdminDb, AuditRow, ConfigVersion, DialDb, Entry, Home, InsertResult, Membership, NewEntry, OAuthToken, Stats, Turn } from './db.ts';
import { chicagoDay } from './rules.js';

type MemoryDb = DialDb & AdminDb & {
  turns: Turn[]; entries: Entry[]; memberships: Membership[]; configs: ConfigVersion[]; adminRows: Admin[]; auditRows: AuditRow[];
  oauthRows: OAuthToken[];
};

export type MemorySeed = {
  properties?: Record<string, string>;            // normalized address key → property key
  homes?: Record<string, Home>;                   // normalized address key → county record
  serviceZips?: { zip: string; name: string }[];
  admins?: Admin[];
};

export function memoryDb(seed: MemorySeed = {}): MemoryDb {
  const turns: Turn[] = [];
  const entries: Entry[] = [];
  const memberships: Membership[] = [];
  const configs: ConfigVersion[] = [];
  const adminRows: Admin[] = [...(seed.admins || [])];
  const auditRows: AuditRow[] = [];
  const oauthRows: OAuthToken[] = [];
  const properties = seed.properties || {};
  const after = (iso: string, since: Date) => new Date(iso) >= since;
  const within = (iso: string | null | undefined, since: Date, until: Date) => !!iso && new Date(iso) >= since && new Date(iso) < until;
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

  return {
    turns, entries, memberships, configs, adminRows, auditRows, oauthRows,
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
      const entry: Entry = { ...e, id: crypto.randomUUID(), monday_item_id: null, redeemed_at: null, redeemed_note: null, voided_at: null, voided_note: null };
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
    },
    async homeProfile(key) { const h = seed.homes?.[key]; return h ? { ...h } : null; },
    async entriesAtAddress(key) { return entries.filter((e) => e.address_key === key).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((e) => ({ ...e })); },
    async serviceZips() { return (seed.serviceZips || []).map((z) => ({ ...z })); },
    async oauthToken(provider) { const t = oauthRows.find((x) => x.provider === provider); return t ? { ...t } : null; },
    async saveOAuthToken(t) {
      const i = oauthRows.findIndex((x) => x.provider === t.provider);
      if (i >= 0) oauthRows[i] = { ...t }; else oauthRows.push({ ...t });
    },

    async latestConfig() { return configs.length ? copy(configs.reduce((a, b) => (b.version > a.version ? b : a))) : null; },
    async configVersion(v) { const c = configs.find((x) => x.version === v); return c ? copy(c) : null; },
    async configVersions(limit) { return copy([...configs].sort((a, b) => b.version - a.version).slice(0, limit)); },
    async insertConfig(row) {
      if (configs.some((x) => x.version === row.version)) return 'conflict';
      configs.push(copy(row));
      return 'ok';
    },

    async admin(email) { const a = adminRows.find((x) => x.email === email.toLowerCase()); return a ? { ...a } : null; },
    async admins() { return adminRows.map((a) => ({ ...a })).sort((a, b) => a.name.localeCompare(b.name)); },
    async addAdmin(a) {
      if (adminRows.some((x) => x.email === a.email)) return 'exists';
      adminRows.push({ ...a });
      return 'ok';
    },
    async removeAdmin(email) { const i = adminRows.findIndex((x) => x.email === email); if (i >= 0) adminRows.splice(i, 1); },
    async setAdminRole(email, role) { const a = adminRows.find((x) => x.email === email); if (a) a.role = role; },

    async audit(row) { auditRows.push({ ...row }); },
    async auditCount(action, since, by) {
      return auditRows.filter((r) => r.action === action && after(r.at, since) && (by.ip ? r.ip === by.ip : true) && (by.target ? r.target === by.target : true)).length;
    },
    async auditFor(target, limit) { return auditRows.filter((r) => r.target === target).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit).map((r) => ({ ...r })); },
    async lastLogins() {
      const out: Record<string, string> = {};
      for (const r of auditRows) if (r.action === 'login' && r.target && (!out[r.target] || r.at > out[r.target])) out[r.target] = r.at;
      return out;
    },

    async entryByCode(code) { const e = entries.find((x) => x.code === code); return e ? { ...e } : null; },
    async entryById(id) { const e = entries.find((x) => x.id === id); return e ? { ...e } : null; },
    async searchEntries(s) {
      const q = parseSearch(s.q);
      const hit = (e: Entry) => {
        if (s.status && codeStatus(e, s.now) !== s.status) return false;
        if (s.gift && e.gift !== s.gift) return false;
        if (!q) return true;
        if ('code' in q) return e.code === q.code;
        if ('phone' in q) return e.phone.includes(q.phone);
        const t = q.text.toLowerCase();
        return [e.address, e.first_name, e.code].some((v) => (v || '').toLowerCase().includes(t));
      };
      const all = entries.filter(hit).sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { rows: all.slice(s.offset, s.offset + s.limit).map((e) => ({ ...e })), total: all.length };
    },
    async redeemEntry(id, now, note) {
      const e = entries.find((x) => x.id === id && !x.redeemed_at && !x.voided_at);
      if (!e) return null;
      e.redeemed_at = now.toISOString(); e.redeemed_note = note;
      return { ...e };
    },
    async stats(since, until) {
      const t = turns.filter((x) => within(x.created_at, since, until));
      const e = entries.filter((x) => within(x.created_at, since, until));
      const r = entries.filter((x) => within(x.redeemed_at, since, until));
      const tally = <K extends string>(keys: string[], init: () => Record<K, number>) => {
        const m = new Map<string, Record<K, number>>();
        for (const k of keys) if (!m.has(k)) m.set(k, init());
        return m;
      };
      const g = tally([...t.map((x) => x.gift), ...e.map((x) => x.gift)], () => ({ turns: 0, claims: 0, redeemed: 0 }));
      for (const x of t) g.get(x.gift)!.turns++;
      for (const x of e) { g.get(x.gift)!.claims++; if (x.redeemed_at) g.get(x.gift)!.redeemed++; }
      const day = (iso: string) => chicagoDay(iso);
      const d = tally([...t.map((x) => day(x.created_at)), ...e.map((x) => day(x.created_at)), ...r.map((x) => day(x.redeemed_at!))], () => ({ turns: 0, claims: 0, redeemed: 0 }));
      for (const x of t) d.get(day(x.created_at))!.turns++;
      for (const x of e) d.get(day(x.created_at))!.claims++;
      for (const x of r) d.get(day(x.redeemed_at!))!.redeemed++;
      const src = (x: Entry) => x.utm?.utm_source || '(direct)';
      const so = tally(e.map(src), () => ({ claims: 0, redeemed: 0 }));
      for (const x of e) { so.get(src(x))!.claims++; if (x.redeemed_at) so.get(src(x))!.redeemed++; }
      const stats: Stats = {
        turns: t.length,
        players: new Set(t.map((x) => x.device).filter(Boolean)).size,
        claims: e.length,
        redeemed: e.filter((x) => x.redeemed_at).length,
        voided: e.filter((x) => x.voided_at).length,
        reminders: e.filter((x) => x.sms_marketing).length,
        versions: [...new Set(t.map((x) => x.config_version || 0))].sort((a, b) => a - b),
        byGift: [...g].map(([gift, v]) => ({ gift, ...v })).sort((a, b) => a.gift.localeCompare(b.gift)),
        byDay: [...d].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
        sources: [...so].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.claims - a.claims || a.source.localeCompare(b.source))
      };
      return stats;
    },

    async allMemberships() { return memberships.map((m) => ({ ...m })).sort((a, b) => a.mem_month.localeCompare(b.mem_month)); },
    async membershipEntries() { return entries.filter((e) => e.mem_month).map((e) => ({ ...e })); }
  };
}
