import type { APIRoute } from 'astro';
import DIAL from '../../../data/dial.json';
import { addDetails, giftById } from '../../lib/dial.ts';
import { announceDetails } from '../../lib/fanout.ts';
import { afterResponse, dbFor, envOf } from '../../lib/runtime.ts';
import { json, preflight, readJson } from '../../lib/http.ts';

/* POST /api/details { turn, firstName?, street, zip } → { ok } — the optional "book faster" step after a win.
 * The turn id from the claim is the only key; it is a random UUID only that visitor's browser has. */
export const POST: APIRoute = async ({ request, locals }) => {
  const env = envOf(locals);
  const db = dbFor(env);
  if (!db) return json(request, { error: `Call ${DIAL.phone} and we'll take it from here.` }, 503);
  const body = await readJson(request);
  if (!body) return json(request, { error: 'Bad request.' }, 400);
  try {
    const res = await addDetails(db, DIAL, { turnId: body.turn, firstName: body.firstName, street: body.street, zip: body.zip });
    if (!res.ok) return json(request, { error: res.error, field: res.field }, res.status);
    await afterResponse(locals, announceDetails(env, db, DIAL, res.entry, giftById(DIAL, res.entry.gift)));
    return json(request, { ok: true });
  } catch (e) {
    console.error('dial details', e);
    return json(request, { error: `That didn't save. Give us your address when you call ${DIAL.phone}.` }, 502);
  }
};

export const OPTIONS: APIRoute = ({ request }) => preflight(request);
