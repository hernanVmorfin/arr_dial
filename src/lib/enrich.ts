/* After a win, before the Monday item is made: what we can learn about the winner from what we already have.
 *   home   the county record for their address (free-year winners give it at the claim; others in "book faster")
 *   prior  earlier items on the Monday leads board with their phone, their Klaviyo profile, and other dial codes at
 *          the same home
 * Each lookup is independent and can fail on its own; a failure is noted in prior.errors and never holds up the win.
 * Runs after the response (lib/fanout.ts), so the visitor never waits on it, and nothing found is sent back to them. */
import { addressKey } from './address.ts';
import { codeStatus } from './db.ts';
import type { DialDb, Entry, Home, Prior } from './db.ts';
import { findLeadsByPhone, mondayConfigured } from './monday.ts';
import { findProfileByPhone, klaviyoConfigured } from './klaviyo.ts';

type Deps = { findLeads?: typeof findLeadsByPhone; findProfile?: typeof findProfileByPhone };

export async function homeFor(db: DialDb, e: Entry): Promise<Home | null> {
  if (!e.address || !e.zip) return null;
  return db.homeProfile(e.address_key || addressKey(e.address, e.zip));
}

export async function priorFor(env: unknown, db: DialDb, e: Entry, now = new Date(), deps: Deps = {}): Promise<Prior> {
  const findLeads = deps.findLeads || findLeadsByPhone, findProfile = deps.findProfile || findProfileByPhone;
  const key = e.address_key || (e.address && e.zip ? addressKey(e.address, e.zip) : null);
  const tasks: Record<string, () => Promise<unknown>> = {};
  if (deps.findLeads || mondayConfigured(env)) tasks.leads = () => findLeads(env, e.phone);
  if (deps.findProfile || klaviyoConfigured(env)) tasks.klaviyo = () => findProfile(env, e.phone);
  if (key) tasks.atAddress = () => db.entriesAtAddress(key);
  const names = Object.keys(tasks);
  const results = await Promise.allSettled(names.map((n) => tasks[n]()));
  const prior: Prior = { checkedAt: now.toISOString() };
  const errors: string[] = [];
  results.forEach((r, i) => {
    const n = names[i];
    if (r.status === 'rejected') { errors.push(`${n}: ${String(r.reason).slice(0, 160)}`); return; }
    if (n === 'leads') prior.leads = (r.value as Prior['leads'] || []).filter((l) => !l.name.includes(e.code));
    if (n === 'klaviyo') prior.klaviyo = (r.value as Prior['klaviyo']) || null;
    if (n === 'atAddress') {
      prior.atAddress = (r.value as Entry[]).filter((x) => x.id !== e.id)
        .map((x) => ({ code: x.code, gift: x.gift, status: codeStatus(x, now), created_at: x.created_at }));
    }
  });
  if (errors.length) { prior.errors = errors; console.error('dial enrich', errors.join(' | ')); }
  return prior;
}

/** Look everything up and save it on the entry. Returns the entry with home and prior filled in. */
export async function enrichEntry(env: unknown, db: DialDb, e: Entry, now = new Date(), deps: Deps = {}): Promise<Entry> {
  const [home, prior] = await Promise.all([
    homeFor(db, e).catch((err) => { console.error('dial home', err); return null; }),
    priorFor(env, db, e, now, deps)
  ]);
  // home only when found: "book faster" may have set it already while this was running
  const saved = await db.updateEntry(e.id, { ...(home ? { home } : {}), prior }).catch((err) => { console.error('dial enrich save', err); return null; });
  return saved || { ...e, home: home || e.home || null, prior };
}

/** After "book faster": the address is new, so the home and the codes at that address are looked up again. The phone
 *  hasn't changed, so the Monday and Klaviyo results from the win are kept. */
export async function enrichAddress(db: DialDb, e: Entry, now = new Date()): Promise<Entry> {
  const home = await homeFor(db, e).catch((err) => { console.error('dial home', err); return null; });
  const at = e.address_key ? await db.entriesAtAddress(e.address_key).catch(() => null) : null;
  const prior: Prior = {
    ...(e.prior || { checkedAt: now.toISOString() }),
    ...(at ? { atAddress: at.filter((x) => x.id !== e.id).map((x) => ({ code: x.code, gift: x.gift, status: codeStatus(x, now), created_at: x.created_at })) } : {})
  };
  const saved = await db.updateEntry(e.id, { home, prior }).catch((err) => { console.error('dial enrich save', err); return null; });
  return saved || { ...e, home, prior };
}
