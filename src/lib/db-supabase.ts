/* Production DialDb: Supabase PostgREST with the server-only secret key, which never leaves this Worker.
 * Tables: supabase/migrations/20261016_comfort_dial.sql. The free-year hold and claim are compare-and-set PATCHes
 * (the filter names the state we expect), so two visitors racing for the same month can't both win it: Postgres
 * re-checks the WHERE clause after the first writer commits and the second update matches nothing. */
import { parseSearch } from './db.ts';
import type { Admin, AdminDb, AuditRow, ConfigVersion, DialDb, Entry, Home, InsertResult, Membership, NewEntry, OAuthToken, Stats, Turn } from './db.ts';
import { envVar } from './env.ts';

const TIMEOUT_MS = 4000;
const T = {
  turns: 'comfort_dial_turns', entries: 'comfort_dial_entries', memberships: 'comfort_dial_memberships',
  config: 'comfort_dial_config', admins: 'comfort_dial_admins', audit: 'comfort_dial_audit', oauth: 'comfort_dial_oauth'
};

export function supabaseConfig(env: unknown) {
  const url = envVar(env, 'SUPABASE_URL');
  const key = envVar(env, 'SUPABASE_SECRET_KEY') || envVar(env, 'SUPABASE_SERVICE_ROLE_KEY');
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

/* Supabase's sb_secret_* keys belong in apikey only. Legacy service-role JWTs still need the Bearer header. */
export const authHeaders = (key: string): Record<string, string> =>
  key.startsWith('sb_secret_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };

export function supabaseDb(env: unknown, fetcher: typeof fetch = fetch): DialDb & AdminDb & { probe(): Promise<'ok' | 'error'> } {
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
      // config_version 0 and an empty context are left out, so a database without the later migrations still works
      const body: Record<string, unknown> = { ...t };
      if (!t.config_version) delete body.config_version;
      if (!t.context) delete body.context;
      const res = await call('POST', T.turns, {}, { body, prefer: 'return=minimal' });
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
      const body: Record<string, unknown> = { ...e };
      for (const k of ['context', 'home', 'prior', 'address_key'] as const) if (body[k] == null) delete body[k];
      const res = await call('POST', T.entries, { select: '*' }, { body, prefer: 'return=representation' });
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
    },

    /* Before the admin migration has run there is no config table: PostgREST answers 404 and the dial runs on the
     * built-in data/dial.json. */
    async latestConfig() {
      const res = await call('GET', T.config, { select: '*', order: 'version.desc', limit: '1' });
      if (res.status === 404) return null;
      return one<ConfigVersion>(res, 'latest config');
    },
    async configVersion(v) { return one<ConfigVersion>(await call('GET', T.config, { select: '*', version: `eq.${v}` }), 'config version'); },
    async configVersions(limit) { return rows<ConfigVersion>(await call('GET', T.config, { select: '*', order: 'version.desc', limit: String(limit) }), 'config versions'); },
    async insertConfig(row) {
      const res = await call('POST', T.config, {}, { body: row, prefer: 'return=minimal' });
      if (res.ok) return 'ok';
      if (res.status === 409) return 'conflict';
      throw new Error(`supabase insert config ${res.status} ${(await res.text()).slice(0, 200)}`);
    },

    async admin(email) { return one<Admin>(await call('GET', T.admins, { select: '*', email: `eq.${email.toLowerCase()}` }), 'admin'); },
    async admins() { return rows<Admin>(await call('GET', T.admins, { select: '*', order: 'name.asc' }), 'admins'); },
    async addAdmin(a) {
      const res = await call('POST', T.admins, {}, { body: a, prefer: 'return=minimal' });
      if (res.ok) return 'ok';
      if (res.status === 409) return 'exists';
      throw new Error(`supabase add admin ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async removeAdmin(email) {
      const res = await call('DELETE', T.admins, { email: `eq.${email}` });
      if (!res.ok) throw new Error(`supabase remove admin ${res.status}`);
    },

    async audit(row: AuditRow) {
      const res = await call('POST', T.audit, {}, { body: row, prefer: 'return=minimal' });
      if (!res.ok) throw new Error(`supabase audit ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async auditCount(action, since, by) {
      return count(T.audit, { action: `eq.${action}`, at: `gte.${iso(since)}`, ...(by.ip ? { ip: `eq.${by.ip}` } : {}), ...(by.target ? { target: `eq.${by.target}` } : {}) });
    },
    async auditFor(target, limit) {
      return rows<AuditRow>(await call('GET', T.audit, { select: 'at,actor,action,target,detail,ip', target: `eq.${target}`, order: 'at.desc', limit: String(limit) }), 'audit for');
    },
    async lastLogins() {
      const r = await rows<{ target: string; at: string }>(await call('GET', T.audit, { select: 'target,at', action: 'eq.login', order: 'at.desc', limit: '500' }), 'last logins');
      const out: Record<string, string> = {};
      for (const x of r) if (x.target && !out[x.target]) out[x.target] = x.at;
      return out;
    },

    async entryByCode(code) { return one<Entry>(await call('GET', T.entries, { select: '*', code: `eq.${code}` }), 'entry by code'); },
    async entryById(id) { return one<Entry>(await call('GET', T.entries, { select: '*', id: `eq.${id}` }), 'entry by id'); },
    async searchEntries(s) {
      const p: Record<string, string> = { select: '*', order: 'created_at.desc', limit: String(s.limit), offset: String(s.offset) };
      const q = parseSearch(s.q);
      if (q && 'code' in q) p.code = `eq.${q.code}`;
      else if (q && 'phone' in q) p.phone = `like.*${q.phone}*`;
      else if (q) p.or = `(${['address', 'first_name', 'code'].map((c) => `${c}.ilike."*${q.text}*"`).join(',')})`;
      const now = iso(s.now);
      if (s.status === 'issued') Object.assign(p, { voided_at: 'is.null', redeemed_at: 'is.null', expires_at: `gt.${now}` });
      if (s.status === 'redeemed') Object.assign(p, { voided_at: 'is.null', redeemed_at: 'not.is.null' });
      if (s.status === 'expired') Object.assign(p, { voided_at: 'is.null', redeemed_at: 'is.null', expires_at: `lte.${now}` });
      if (s.status === 'void') p.voided_at = 'not.is.null';
      if (s.gift) p.gift = `eq.${s.gift}`;
      const res = await call('GET', T.entries, p, { prefer: 'count=exact' });
      const list = await rows<Entry>(res, 'search entries');
      const m = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
      return { rows: list, total: m ? Number(m[1]) : list.length };
    },
    async redeemEntry(id, now, note) {
      return one<Entry>(await call('PATCH', T.entries, { id: `eq.${id}`, redeemed_at: 'is.null', voided_at: 'is.null', select: '*' },
        { body: { redeemed_at: iso(now), redeemed_note: note }, prefer: 'return=representation' }), 'redeem entry');
    },
    async homeProfile(key) {
      const res = await call('POST', 'rpc/comfort_dial_home', {}, { body: { p_key: key } });
      if (!res.ok) throw new Error(`supabase home ${res.status} ${(await res.text()).slice(0, 200)}`);
      const h = await res.json();
      return h && typeof h === 'object' && Object.keys(h).length ? (h as Home) : null;
    },
    async entriesAtAddress(key) {
      return rows<Entry>(await call('GET', T.entries, { select: '*', address_key: `eq.${key}`, order: 'created_at.desc', limit: '20' }), 'entries at address');
    },
    async serviceZips() {
      return rows<{ zip: string; name: string }>(await call('GET', 'service_area_zips', { select: 'zip,name', active: 'is.true', order: 'priority.asc,zip.asc' }), 'service zips');
    },
    /* Before the OAuth migration has run there is no table: PostgREST answers 404 and each isolate keeps its own token. */
    async oauthToken(provider) {
      const res = await call('GET', T.oauth, { select: '*', provider: `eq.${provider}` });
      if (res.status === 404) return null;
      return one<OAuthToken>(res, 'oauth token');
    },
    async saveOAuthToken(t) {
      const res = await call('POST', T.oauth, { on_conflict: 'provider' }, { body: t, prefer: 'resolution=merge-duplicates,return=minimal' });
      if (!res.ok) throw new Error(`supabase save oauth ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async stats(since, until) {
      const res = await call('POST', 'rpc/comfort_dial_stats', {}, { body: { p_since: iso(since), p_until: iso(until) } });
      if (!res.ok) throw new Error(`supabase stats ${res.status} ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as Stats;
    },

    async allMemberships() { return rows<Membership>(await call('GET', T.memberships, { select: '*', order: 'mem_month.asc' }), 'memberships'); },
    async membershipEntries() {
      return rows<Entry>(await call('GET', T.entries, { select: '*', mem_month: 'not.is.null', order: 'mem_month.asc' }), 'membership entries');
    }
  };
}
