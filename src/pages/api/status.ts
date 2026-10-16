import type { APIRoute } from 'astro';
import DIAL from '../../../data/dial.json';
import { status } from '../../lib/dial.ts';
import { dbFor, envOf } from '../../lib/runtime.ts';
import { envVar } from '../../lib/env.ts';
import { json, preflight } from '../../lib/http.ts';

/* GET /api/status → the line under the dial, plus what the popup needs before the first turn.
 * enabled:false means Supabase isn't configured; the popup then shows a call-us message instead of the dial. */
export const GET: APIRoute = async ({ request, locals }) => {
  const env = envOf(locals);
  const db = dbFor(env);
  if (!db) return json(request, { enabled: false, phone: DIAL.phone });
  const base = { enabled: true, holdMinutes: DIAL.holdMinutes, turnstileSiteKey: envVar(env, 'TURNSTILE_SITE_KEY') || null };
  try { return json(request, { ...base, ...(await status(db, DIAL)) }); }
  catch (e) {
    console.error('dial status', e);
    return json(request, { ...base, degraded: true, membershipOpen: false, membershipsLeft: null, nextUnlock: null });
  }
};

export const OPTIONS: APIRoute = ({ request }) => preflight(request);
