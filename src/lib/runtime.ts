/* Per-request plumbing for the API routes: which database, the live config, the env, IP limits, and running work
 * after the response. */
import BUILT_IN from '../../data/dial.json';
import { supabaseConfig, supabaseDb } from './db-supabase.ts';
import { memoryDb } from './db-memory.ts';
import { envVar } from './env.ts';
import { liveConfig } from './config.ts';
import { memoryAuth, supabaseAuth, type PasswordAuth } from './admin/auth.ts';
import type { AdminDb, DialDb } from './db.ts';
import type { Cfg } from './dial.ts';

export type Db = DialDb & AdminDb;

/* `astro dev` without Supabase keys keeps everything in memory so the whole flow can be clicked through locally.
 * import.meta.env.DEV is replaced with `false` in a production build, so this branch doesn't exist on the site.
 * The sample home lets a local free-year winner pass the county-record check; the sample admin signs in to the
 * local admin (README, "Develop"), and the sample CSR to see the Codes-only view. */
export const DEV_ADMIN = { email: 'admin@arrhvac.test', name: 'Local Admin', password: 'dial-admin-local' };
export const DEV_CSR = { email: 'csr@arrhvac.test', name: 'Local CSR', password: 'dial-csr-local' };
let devDb: Db | null = null;
export function dbFor(env: unknown): Db | null {
  if (supabaseConfig(env)) return supabaseDb(env);
  if (import.meta.env.DEV) {
    return (devDb ||= memoryDb({
      properties: { '14532 S RAVINIA AVE|60462': 'dev:14532-ravinia' },
      homes: { '14532 S RAVINIA AVE|60462': { propertyKey: 'dev:14532-ravinia', county: 'Cook', township: 'Orland', yearBuilt: 1978, sqft: 1840, stories: '2', style: '2-story frame/brick', heating: 'Hot Water Steam', centralAir: false, basement: 'Full', basementFinish: 'Unfinished' } },
      serviceZips: ['60643', '60655', '60805', '60453', '60463', '60464', '60462', '60467', '60477', '60487', '60439', '60491', '60448', '60423'].map((zip) => ({ zip, name: zip })),
      admins: [
        { email: DEV_ADMIN.email, name: DEV_ADMIN.name, created_at: new Date().toISOString(), created_by: 'dev' },
        { email: DEV_CSR.email, name: DEV_CSR.name, role: 'csr', created_at: new Date().toISOString(), created_by: 'dev' }
      ]
    }));
  }
  return null;
}

let devAuth: PasswordAuth | null = null;
export function authFor(env: unknown): PasswordAuth | null {
  if (supabaseConfig(env)) return supabaseAuth(env);
  if (import.meta.env.DEV) return (devAuth ||= memoryAuth({ [DEV_ADMIN.email]: DEV_ADMIN.password, [DEV_CSR.email]: DEV_CSR.password }));
  return null;
}

/** ARR's ZIPs (service_area_zips), kept per isolate for 10 minutes: they change rarely and every turn asks. An
 *  empty list when they can't be read; the turn goes on without the in-area flag. */
let zips: { list: { zip: string; name: string }[]; at: number } | null = null;
export async function serviceZipsFor(db: Db | null, now = Date.now()) {
  if (!db) return [];
  if (zips && now - zips.at < 600_000) return zips.list;
  try { zips = { list: await db.serviceZips(), at: now }; }
  catch (e) { console.error('dial service zips', e); zips = { list: zips?.list || [], at: now - 540_000 }; }
  return zips.list;
}

/** Cloudflare's view of the visitor (request.cf): city, ZIP, ISP. Absent in some proxies and in plain Node. */
export const cfOf = (locals: App.Locals, request: Request): Record<string, unknown> | null =>
  ((locals as any).runtime?.cf || (request as any).cf || null) as Record<string, unknown> | null;

/** The live config (lib/config.ts), falling back to data/dial.json. */
export const configFor = (db: Db | null): Promise<Cfg> => liveConfig(db, BUILT_IN);
export const builtInConfig = () => BUILT_IN as unknown as Cfg;

export const ipLimitsOn = (env: unknown) => (envVar(env, 'DIAL_IP_LIMITS') || 'on').toLowerCase() !== 'off';

/** Run `work` after the response when the Worker allows it (waitUntil), otherwise before returning. */
export async function afterResponse(locals: App.Locals, work: Promise<unknown>) {
  const ctx = (locals as any).runtime?.ctx;
  if (ctx?.waitUntil) ctx.waitUntil(work.catch((e: unknown) => console.error('dial after-response', e)));
  else await work.catch((e: unknown) => console.error('dial after-response', e));
}

export const envOf = (locals: App.Locals): Record<string, unknown> => ((locals as any).runtime?.env || {}) as Record<string, unknown>;
