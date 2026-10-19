import type { APIRoute } from 'astro';
import { giftById } from '../../lib/dial.ts';
import { parseRedeemedWebhook } from '../../lib/monday.ts';
import { announceRedeemed } from '../../lib/fanout.ts';
import { afterResponse, configFor, dbFor, envOf } from '../../lib/runtime.ts';
import { envVar } from '../../lib/env.ts';

/* POST /api/redeemed?key=<MONDAY_WEBHOOK_SECRET> — Monday's "When a column changes, send a webhook" on the Code status
 * column. Setting a dial item to Redeemed marks its code used in Supabase and tells Klaviyo, which stops the
 * reminders. Board webhooks carry no signature, hence the shared secret in the URL. */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const env = envOf(locals);
  const secret = envVar(env, 'MONDAY_WEBHOOK_SECRET');
  const plain = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (!secret || url.searchParams.get('key') !== secret) return plain(401, { error: 'unauthorized' });

  let body: any;
  try { body = await request.json(); } catch { return plain(400, { error: 'bad json' }); }
  const parsed = parseRedeemedWebhook(body, envVar(env, 'MONDAY_CODE_STATUS_COLUMN'));
  if (parsed && 'challenge' in parsed) return plain(200, { challenge: parsed.challenge });
  if (!parsed) return plain(200, { ok: true, ignored: true });

  const db = dbFor(env);
  if (!db) return plain(503, { error: 'not configured' });
  try {
    const entry = await db.redeemByMondayItem(parsed.itemId, new Date(), 'Code status set to Redeemed in Monday');
    if (entry) await afterResponse(locals, announceRedeemed(env, entry, giftById(await configFor(db), entry.gift)));
    return plain(200, { ok: true, redeemed: entry ? entry.code : null });
  } catch (e) {
    console.error('dial redeemed', e);
    return plain(502, { error: 'failed' });
  }
};
