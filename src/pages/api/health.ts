import type { APIRoute } from 'astro';
import { chicagoMonth, inSeason, membershipActive } from '../../lib/rules.js';
import { supabaseConfig, supabaseDb } from '../../lib/db-supabase.ts';
import { mondayConfigured } from '../../lib/monday.ts';
import { podiumAuth, podiumConfigured } from '../../lib/podium.ts';
import { klaviyoConfigured } from '../../lib/klaviyo.ts';
import { cfOf, configFor, dbFor, envOf, ipLimitsOn } from '../../lib/runtime.ts';
import { geoFrom } from '../../lib/visit.js';
import { envVar } from '../../lib/env.ts';
import { clientIp, json } from '../../lib/http.ts';

/* GET /api/health[?deep=1]. `build` answers "did my push ship?". ?deep=1 also reads Supabase and shows the IP this
 * Worker sees for you: if it isn't your own IP (Webflow's proxy, the same for everyone), set DIAL_IP_LIMITS=off.
 * `yourPlace` is the city/ZIP Cloudflare gives for that IP: null means the visit context gets no location.
 * `podiumAuth.mode` is how code texts sign in to Podium: oauth (refreshed token), static (PODIUM_API_TOKEN as is) or
 * none. `expiresAt` is when that token runs out: this isolate's copy, or with ?deep=1 the shared one in Supabase
 * (null: not refreshed yet, or a static token that doesn't say).
 * The typeof guard matters: a bare __BUILD__ throws if the define is ever dropped, and health has to answer. */
const build = typeof __BUILD__ === 'undefined' ? { commit: 'unknown', builtAt: null } : __BUILD__;

export const GET: APIRoute = async (ctx) => {
  const { request, locals, url } = ctx;
  const env = envOf(locals);
  const deep = url.searchParams.get('deep') === '1';
  const supabase = !supabaseConfig(env) ? 'not_configured' : deep ? await supabaseDb(env).probe() : 'configured';
  const month = chicagoMonth();
  const db = dbFor(env);
  const DIAL = await configFor(db);
  const podium = await podiumAuth(env, deep ? db : null);
  return json(request, {
    ok: true, dial: supabase !== 'not_configured', build,
    config: { version: DIAL.version ?? 0, enabled: DIAL.enabled !== false },
    integrations: {
      supabase,
      monday: mondayConfigured(env), mondayCodeStatusColumn: !!envVar(env, 'MONDAY_CODE_STATUS_COLUMN'), mondayWebhook: !!envVar(env, 'MONDAY_WEBHOOK_SECRET'),
      podium: podiumConfigured(env), podiumAuth: podium, klaviyo: klaviyoConfigured(env), klaviyoSmsList: !!envVar(env, 'KLAVIYO_SMS_LIST_ID'),
      turnstile: !!(envVar(env, 'TURNSTILE_SITE_KEY') && envVar(env, 'TURNSTILE_SECRET_KEY'))
    },
    ipLimits: ipLimitsOn(env),
    season: { month, freeYearInSeason: membershipActive(DIAL) && inSeason(DIAL, month), months: DIAL.membership.months },
    ...(deep ? { yourIp: clientIp(request, () => ctx.clientAddress), yourPlace: geoFrom(cfOf(locals, request), null) } : {})
  });
};
