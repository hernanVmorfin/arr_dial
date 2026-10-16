/* Per-request plumbing for the API routes: which database, the env, IP limits, and running work after the response. */
import { supabaseConfig, supabaseDb } from './db-supabase.ts';
import { memoryDb } from './db-memory.ts';
import { envVar } from './env.ts';
import type { DialDb } from './db.ts';

/* `astro dev` without Supabase keys keeps everything in memory so the whole flow can be clicked through locally.
 * import.meta.env.DEV is replaced with `false` in a production build, so this branch doesn't exist on the site.
 * The sample home lets a local free-year winner pass the county-record check. */
let devDb: DialDb | null = null;
export function dbFor(env: unknown): DialDb | null {
  if (supabaseConfig(env)) return supabaseDb(env);
  if (import.meta.env.DEV) return (devDb ||= memoryDb({ properties: { '14532 S RAVINIA AVE|60462': 'dev:14532-ravinia' } }));
  return null;
}

export const ipLimitsOn = (env: unknown) => (envVar(env, 'DIAL_IP_LIMITS') || 'on').toLowerCase() !== 'off';

/** Run `work` after the response when the Worker allows it (waitUntil), otherwise before returning. */
export async function afterResponse(locals: App.Locals, work: Promise<unknown>) {
  const ctx = (locals as any).runtime?.ctx;
  if (ctx?.waitUntil) ctx.waitUntil(work.catch((e: unknown) => console.error('dial after-response', e)));
  else await work.catch((e: unknown) => console.error('dial after-response', e));
}

export const envOf = (locals: App.Locals): Record<string, unknown> => ((locals as any).runtime?.env || {}) as Record<string, unknown>;
