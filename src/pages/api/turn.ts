import type { APIRoute } from 'astro';
import { takeTurn } from '../../lib/dial.ts';
import { configFor, dbFor, envOf, ipLimitsOn } from '../../lib/runtime.ts';
import { envVar } from '../../lib/env.ts';
import { verifyTurnstile } from '../../lib/turnstile.ts';
import { clientIp, json, preflight, readJson } from '../../lib/http.ts';

/* POST /api/turn { device, token } → { ok, turn, heldUntil, holdSeconds, gift }
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
    const res = await takeTurn(db, DIAL, { ip, device, ipLimits: ipLimitsOn(env) });
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
