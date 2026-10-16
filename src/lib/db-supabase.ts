/* Production DialDb: Supabase PostgREST with the server-only secret key, which never leaves this Worker.
 * Tables: supabase/migrations/20261016_comfort_dial.sql. The free-year hold and claim are compare-and-set PATCHes
 * (the filter names the state we expect), so two visitors racing for the same month can't both win it: Postgres
 * re-checks the WHERE clause after the first writer commits and the second update matches nothing. */
import type { DialDb, Entry, InsertResult, Membership, NewEntry, Turn } from './db.ts';
import { envVar } from './env.ts';

const TIMEOUT_MS = 4000;
const T = { turns: 'comfort_dial_turns', entries: 'comfort_dial_entries', memberships: 'comfort_dial_memberships' };

export function supabaseConfig(env: unknown) {
  const url = envVar(env, 'SUPABASE_URL');
  const key = envVar(env, 'SUPABASE_SECRET_KEY') || envVar(env, 'SUPABASE_SERVICE_ROLE_KEY');
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

/* Supabase's sb_secret_* keys belong in apikey only. Legacy service-role JWTs still need the Bearer header. */
const authHeaders = (key: string): Record<string, string> =>
  key.startsWith('sb_secret_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };

export function supabaseDb(env: unknown, fetcher: typeof fetch = fetch): DialDb & { probe(): Promise<'ok' | 'error'> } {
  const c = supabaseConfig(env);
  if (!c) throw new Error('Supabase is not configured');

  async function call(method: string, table: string, params: Record<string, string>, opts: { body?: unknown; prefer?: string } = {}) {
    const url = new URL(`${c!.url}/rest/v1/${table}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return fetcher(url, {
      method,
      headers: { ...authHeaders(c!.key), Accept: 'application/json', 'Content-Type': 'application/json', ...(opts.prefer ? { Prefer: opts.prefer } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  }
  async function rows<R>(res: Response, what: string): Promise<R[]> {
    if (!res.ok) throw new Error(`supabase ${what} ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error(`supabase ${what} returned a non-array`);
    return body as R[];
  }
  const one = async <R>(res: Response, what: string) => (await rows<R>(res, what))[0] || null;
  async function count(table: string, params: Record<string, string>) {
    const res = await call('GET', table, { select: 'id', limit: '1', ...params }, { prefer: 'count=exact' });
    if (!res.ok) throw new Error(`supabase count ${table} ${res.status}`);
    const m = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
    return m ? Number(m[1]) : 0;
  }
  const iso = (d: Date) => d.toISOString();

  return {
    async probe() {
      try { await rows(await call('GET', T.entries, { select: 'id', limit: '1' }), 'probe'); return 'ok'; } catch { return 'error'; }
    },
    async countTurns(since, by) {
      return count(T.turns, { created_at: `gte.${iso(since)}`, ...(by.ip ? { ip: `eq.${by.ip}` } : {}), ...(by.device ? { device: `eq.${by.device}` } : {}) });
    },
    async countEntries(since, ip) { return count(T.entries, { created_at: `gte.${iso(since)}`, ip: `eq.${ip}` }); },
    async membership(month) {
      return one<Membership>(await call('GET', T.memberships, { select: '*', mem_month: `eq.${month}` }), 'membership');
    },
    async claimedMonths() {
      return (await rows<{ mem_month: string }>(await call('GET', T.memberships, { select: 'mem_month', claimed_at: 'not.is.null' }), 'claimed months')).map((r) => r.mem_month);
    },
    async holdMembership(month, turnId, until, now) {
      const ins = await call('POST', T.memberships, {}, { body: { mem_month: month, turn_id: turnId, held_until: iso(until) }, prefer: 'return=minimal' });
      if (ins.ok) return true;
      if (ins.status !== 409) throw new Error(`supabase hold ${ins.status} ${(await ins.text()).slice(0, 200)}`);
      // Someone held it before. Take it over only if that hold ran out unclaimed.
      const swapped = await rows(await call('PATCH', T.memberships,
        { mem_month: `eq.${month}`, claimed_at: 'is.null', held_until: `lt.${iso(now)}` },
        { body: { turn_id: turnId, held_until: iso(until) }, prefer: 'return=representation' }), 'hold swap');
      return swapped.length > 0;
    },
    async releaseMembership(month, turnId, now) {
      await rows(await call('PATCH', T.memberships, { mem_month: `eq.${month}`, turn_id: `eq.${turnId}`, claimed_at: 'is.null' },
        { body: { held_until: iso(now) }, prefer: 'return=representation' }), 'release');
    },
    async claimMembership(month, turnId, now) {
      const r = await rows(await call('PATCH', T.memberships, { mem_month: `eq.${month}`, turn_id: `eq.${turnId}`, claimed_at: 'is.null' },
        { body: { claimed_at: iso(now) }, prefer: 'return=representation' }), 'claim membership');
      return r.length > 0;
    },
    async unclaimMembership(month, turnId, now) {
      await rows(await call('PATCH', T.memberships, { mem_month: `eq.${month}`, turn_id: `eq.${turnId}` },
        { body: { claimed_at: null, held_until: iso(now) }, prefer: 'return=representation' }), 'unclaim');
    },
    async insertTurn(t: Turn) {
      const res = await call('POST', T.turns, {}, { body: t, prefer: 'return=minimal' });
      if (!res.ok) throw new Error(`supabase insert turn ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async getTurn(id) { return one<Turn>(await call('GET', T.turns, { select: '*', id: `eq.${id}` }), 'turn'); },
    async markTurnClaimed(id, entryId, now) {
      await rows(await call('PATCH', T.turns, { id: `eq.${id}` }, { body: { claimed_at: iso(now), entry_id: entryId }, prefer: 'return=representation' }), 'mark claimed');
    },
    async entryByPhone(phone) { return one<Entry>(await call('GET', T.entries, { select: '*', phone: `eq.${phone}` }), 'entry by phone'); },
    async entryByTurn(turnId) { return one<Entry>(await call('GET', T.entries, { select: '*', turn_id: `eq.${turnId}` }), 'entry by turn'); },
    async membershipEntryForHousehold(hk) {
      return one<Entry>(await call('GET', T.entries, { select: '*', gift: 'eq.mem', household_key: `eq.${hk}` }), 'household');
    },
    async insertEntry(e: NewEntry): Promise<InsertResult> {
      const res = await call('POST', T.entries, { select: '*' }, { body: e, prefer: 'return=representation' });
      if (res.ok) return { ok: true, entry: (await res.json() as Entry[])[0] };
      const text = await res.text();
      if (res.status !== 409) throw new Error(`supabase insert entry ${res.status} ${text.slice(0, 200)}`);
      // Match constraint names, not words: every PostgREST unique-violation body carries "23505".
      if (text.includes('comfort_dial_entries_code_key')) return { ok: false, conflict: 'code' };
      if (text.includes('comfort_dial_entries_phone_key')) return { ok: false, conflict: 'phone' };
      if (text.includes('comfort_dial_entries_turn_key')) return { ok: false, conflict: 'turn' };
      if (text.includes('one_membership_per')) return { ok: false, conflict: 'membership' };
      return { ok: false, conflict: 'other', detail: text.slice(0, 200) };
    },
    async updateEntry(id, patch) {
      return one<Entry>(await call('PATCH', T.entries, { id: `eq.${id}`, select: '*' }, { body: patch, prefer: 'return=representation' }), 'update entry');
    },
    async propertyKey(key) {
      try {
        const r = await one<{ property_key: string }>(await call('GET', 'property_addresses', { select: 'property_key', normalized_key: `eq.${key}`, limit: '1' }), 'property');
        return r?.property_key || null;
      } catch { return null; }
    },
    async redeemByMondayItem(itemId, now, note) {
      return one<Entry>(await call('PATCH', T.entries, { monday_item_id: `eq.${itemId}`, redeemed_at: 'is.null', select: '*' },
        { body: { redeemed_at: iso(now), redeemed_note: note }, prefer: 'return=representation' }), 'redeem');
    }
  };
}
