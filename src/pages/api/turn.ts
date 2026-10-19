import type { APIRoute } from 'astro';
import { takeTurn } from '../../lib/dial.ts';
import { cfOf, configFor, dbFor, envOf, ipLimitsOn, serviceZipsFor } from '../../lib/runtime.ts';
import { cleanContext, geoFrom } from '../../lib/visit.js';
import { envVar } from '../../lib/env.ts';
import { verifyTurnstile } from '../../lib/turnstile.ts';
import { clientIp, json, preflight, readJson } from '../../lib/http.ts';

/* POST /api/turn { device, token, context } → { ok, turn, heldUntil, holdSeconds, gift }
 * `context` is the visit the popup recorded (lib/visit.js); the server adds the rough place from the IP. It is stored
 * with the turn and follows the code if they claim. Never echoed back.
 * Picks the gift here, never in the browser, by the live config's odds, and holds it for holdMinutes. `turn` is the
 * claim token. 503 reason:'paused' while the dial is switched off in the admin. */
export const POST: APIRoute = async (ctx) => {
  const { request, locals } = ctx;
  const env = envOf(locals);
  const db = dbFor(env);
  const DIAL = await configFor(db);
  if (!db) return json(request, { error: `The dial is resting right now. Call ${DIAL.phone} and we'll take care of you.` }, 503);
  const body = await readJson(request);
  if (!body) return json(request, { error: 'Bad request.' }, 400);
  const ip = clientIp(request, () => ctx.clientAddress);

  const secret = envVar(env, 'TURNSTILE_SECRET_KEY');
  if (secret && !(await verifyTurnstile(secret, body.token, ip))) {
    return json(request, { error: `We couldn't confirm you're a person. Refresh the page and try again, or call ${DIAL.phone}.`, reason: 'bot' }, 403);
  }
  const device = typeof body.device === 'string' && /^[\w-]{8,64}$/.test(body.device) ? body.device : null;

  try {
    const geo = geoFrom(cfOf(locals, request), await serviceZipsFor(db));
    const visit = cleanContext(body.context);
    const context = visit || geo ? { ...(visit || {}), ...(geo ? { geo } : {}) } : null;
    const res = await takeTurn(db, DIAL, { ip, device, ipLimits: ipLimitsOn(env), context });
    if (!res.ok) return json(request, { error: res.error, reason: res.reason }, res.status);
    const { turn, gift } = res;
    return json(request, {
      ok: true, turn: turn.id, heldUntil: turn.held_until, holdSeconds: DIAL.holdMinutes * 60,
      gift: { id: gift.id, name: gift.name, short: gift.short, sub: gift.sub, value: gift.value }
    });
  } catch (e) {
    console.error('dial turn', e);
    return json(request, { error: `The dial hit a snag on our end. Try again in a minute, or call ${DIAL.phone}.` }, 502);
  }
};

export const OPTIONS: APIRoute = ({ request }) => preflight(request);
