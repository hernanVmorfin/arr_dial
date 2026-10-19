import type { APIRoute } from 'astro';
import { visitorSpot, weatherAt } from '../../lib/weather.ts';
import { json, preflight } from '../../lib/http.ts';

/* GET /api/weather → outside temperature, conditions and humidity where the visitor is (Cloudflare's IP estimate,
 * no prompt), for the thermostat screen. Its own route so a slow weather service never holds up /api/status or the
 * popup opening. ok:false hides the weather. Private cache: the answer depends on who asks. */
export const GET: APIRoute = async ({ request, locals }) => {
  const spot = visitorSpot((locals as any).runtime?.cf);
  const w = await weatherAt(spot);
  return w
    ? json(request, { ok: true, ...w, place: spot.place }, 200, { 'cache-control': 'private, max-age=600' })
    : json(request, { ok: false }, 200, { 'cache-control': 'private, max-age=120' });
};

export const OPTIONS: APIRoute = ({ request }) => preflight(request);
