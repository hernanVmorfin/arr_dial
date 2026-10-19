import type { APIRoute } from 'astro';
import { status } from '../../lib/dial.ts';
import { publicConfig } from '../../lib/config.ts';
import { configFor, dbFor, envOf } from '../../lib/runtime.ts';
import { envVar } from '../../lib/env.ts';
import { json, preflight } from '../../lib/http.ts';

/* GET /api/status → the line under the dial, plus everything the popup draws from: gifts, odds, dial layout, phone,
 * and when it may open by itself (`dial`, the live config from the admin).
 * enabled:false means the popup shows a call-us message instead of the dial: Supabase isn't configured, or the dial
 * was paused in the admin (paused:true). */
export const GET: APIRoute = async ({ request, locals }) => {
  const env = envOf(locals);
  const db = dbFor(env);
  const cfg = await configFor(db);
  if (!db) return json(request, { enabled: false, phone: cfg.phone });
  const dial = publicConfig(cfg);
  if (cfg.enabled === false) return json(request, { enabled: false, paused: true, phone: cfg.phone, dial });
  const base = { enabled: true, holdMinutes: cfg.holdMinutes, turnstileSiteKey: envVar(env, 'TURNSTILE_SITE_KEY') || null, dial };
  try { return json(request, { ...base, ...(await status(db, cfg)) }); }
  catch (e) {
    console.error('dial status', e);
    return json(request, { ...base, degraded: true, membershipOpen: false, membershipsLeft: null, nextUnlock: null });
  }
};

export const OPTIONS: APIRoute = ({ request }) => preflight(request);
