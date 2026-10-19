/* Podium texts each new winner their code from ARR's number, so a reply lands with the office where CSRs work.
 * A phone can win only once (unique in comfort_dial_entries) and repeat claims send nothing, so the dial itself texts
 * a given number once. An admin can resend it (a customer lost the text), at most 3 times a day per code, logged.
 * The copy is fixed; the only visitor-supplied value is the phone itself. */
import { chicagoDate } from './rules.js';
import { envVar } from './env.ts';
import type { Entry } from './db.ts';
import type { Cfg, Gift } from './dial.ts';

export const podiumConfigured = (env: unknown) => !!(envVar(env, 'PODIUM_API_TOKEN') && envVar(env, 'PODIUM_LOCATION_UID'));

export function codeText(e: Entry, gift: Gift, cfg: Cfg) {
  const date = chicagoDate(e.expires_at).replace(/, \d{4}$/, '');
  return `Always Ready Repair: your Comfort Dial gift is ${gift.name}. Code ${e.code}, good through ${date}. Call or text ${cfg.phone} to book and give the code.`;
}

export async function sendCodeText(env: unknown, e: Entry, gift: Gift, cfg: Cfg) {
  const res = await fetch('https://api.podium.com/v4/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${envVar(env, 'PODIUM_API_TOKEN')}` },
    body: JSON.stringify({ locationUid: envVar(env, 'PODIUM_LOCATION_UID'), channel: { type: 'phone', identifier: e.phone }, body: codeText(e, gift, cfg) }),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`podium ${res.status} ${(await res.text()).slice(0, 200)}`);
}
