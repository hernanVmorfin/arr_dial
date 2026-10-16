import type { APIRoute } from 'astro';
import DIAL from '../../../data/dial.json';
import { claimGift } from '../../lib/dial.ts';
import { chicagoDate } from '../../lib/rules.js';
import { announceWin } from '../../lib/fanout.ts';
import { afterResponse, dbFor, envOf, ipLimitsOn } from '../../lib/runtime.ts';
import { clientIp, json, preflight, readJson } from '../../lib/http.ts';

/* POST /api/claim { turn, phone, street?, zip?, reminders, utm?, page? }
 *   → { ok, duplicate:false, code, expiresAt, expiresOn, gift }   a win (texted, on Monday, to Klaviyo)
 *   → { ok, duplicate:true, message }                             this phone already has a gift; nothing is revealed
 *   → { error, field?, reason? }                                  400 field · 404/410 turn again · 409 · 429 · 502 */
export const POST: APIRoute = async (ctx) => {
  const { request, locals } = ctx;
  const env = envOf(locals);
  const db = dbFor(env);
  if (!db) return json(request, { error: `The dial is resting right now. Call ${DIAL.phone} and we'll take care of you.` }, 503);
  const body = await readJson(request);
  if (!body) return json(request, { error: 'Bad request.' }, 400);

  try {
    const res = await claimGift(db, DIAL, {
      turnId: body.turn, phone: body.phone, street: body.street, zip: body.zip, reminders: body.reminders,
      utm: body.utm, page: body.page, ip: clientIp(request, () => ctx.clientAddress), ipLimits: ipLimitsOn(env)
    });
    if (!res.ok) return json(request, { error: res.error, field: res.field, reason: res.reason }, res.status);
    if (res.duplicate) {
      return json(request, { ok: true, duplicate: true, message: `This number already has a Comfort Dial gift. Your code is in the text we sent when you claimed it. Lost it? Call ${DIAL.phone}.` });
    }
    const { entry, gift } = res;
    if (res.fresh) await afterResponse(locals, announceWin(env, db, DIAL, entry, gift));
    return json(request, {
      ok: true, duplicate: false, code: entry.code, expiresAt: entry.expires_at, expiresOn: chicagoDate(entry.expires_at),
      gift: { id: gift.id, name: gift.name, short: gift.short, sub: gift.sub, value: gift.value }, hasAddress: !!entry.address
    });
  } catch (e) {
    console.error('dial claim', e);
    return json(request, { error: `The dial hit a snag on our end. Try again in a minute, or call ${DIAL.phone}.` }, 502);
  }
};

export const OPTIONS: APIRoute = ({ request }) => preflight(request);
