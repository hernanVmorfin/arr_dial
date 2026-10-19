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
 * local admin (README, "Develop"). */
export const DEV_ADMIN = { email: 'admin@arrhvac.test', name: 'Local Admin', password: 'dial-admin-local' };
let devDb: Db | null = null;
export function dbFor(env: unknown): Db | null {
  if (supabaseConfig(env)) return supabaseDb(env);
  if (import.meta.env.DEV) {
    return (devDb ||= memoryDb({
      properties: { '14532 S RAVINIA AVE|60462': 'dev:14532-ravinia' },
      admins: [{ email: DEV_ADMIN.email, name: DEV_ADMIN.name, created_at: new Date().toISOString(), created_by: 'dev' }]
    }));
  }
  return null;
}

let devAuth: PasswordAuth | null = null;
export function authFor(env: unknown): PasswordAuth | null {
  if (supabaseConfig(env)) return supabaseAuth(env);
  if (import.meta.env.DEV) return (devAuth ||= memoryAuth({ [DEV_ADMIN.email]: DEV_ADMIN.password }));
  return null;
}

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
