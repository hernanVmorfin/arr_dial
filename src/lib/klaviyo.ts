/* Klaviyo runs the follow-up: each win is a "Comfort Dial Won" event, which triggers the reminder flow (day 7 and
 * day 25, docs/KLAVIYO.md). A Monday "Redeemed" sends "Comfort Dial Redeemed", which the flow filters on, so a
 * customer who already booked stops getting reminders. Reminder texts go only to winners who ticked the reminder box:
 * that box is the SMS marketing consent, recorded here with a subscription job. */
import { chicagoDate } from './rules.js';
import { envVar } from './env.ts';
import type { Entry } from './db.ts';
import type { Cfg, Gift } from './dial.ts';

const API = 'https://a.klaviyo.com/api';
const REVISION = '2025-01-15';
export const METRIC_WON = 'Comfort Dial Won';
export const METRIC_REDEEMED = 'Comfort Dial Redeemed';
export const METRIC_VOIDED = 'Comfort Dial Voided';

export const klaviyoConfigured = (env: unknown) => !!envVar(env, 'KLAVIYO_PRIVATE_KEY');
const e164 = (tenDigits: string) => `+1${tenDigits}`;

function profile(e: Entry) {
  return { data: { type: 'profile', attributes: { phone_number: e164(e.phone), ...(e.first_name ? { first_name: e.first_name } : {}) } } };
}

export function wonEvent(e: Entry, gift: Gift, cfg: Cfg) {
  return {
    data: {
      type: 'event',
      attributes: {
        properties: {
          code: e.code, gift_id: gift.id, gift_name: gift.name, gift_short: gift.short, gift_value: gift.value,
          expires_at: e.expires_at, expires_on: chicagoDate(e.expires_at).replace(/, \d{4}$/, ''),
          reminders_opt_in: e.sms_marketing, phone_display: cfg.phone, source: 'Comfort Dial',
          ...(e.utm || {})
        },
        time: e.created_at,
        unique_id: e.code,
        metric: { data: { type: 'metric', attributes: { name: METRIC_WON } } },
        profile: profile(e)
      }
    }
  };
}

export function redeemedEvent(e: Entry, gift: Gift, now: Date, metric = METRIC_REDEEMED) {
  const suffix = metric === METRIC_VOIDED ? `voided-${now.getTime()}` : 'redeemed';
  return {
    data: {
      type: 'event',
      attributes: {
        properties: { code: e.code, gift_id: gift.id, gift_name: gift.name, source: 'Comfort Dial' },
        time: now.toISOString(),
        unique_id: `${e.code}-${suffix}`,
        metric: { data: { type: 'metric', attributes: { name: metric } } },
        profile: profile(e)
      }
    }
  };
}

export function smsSubscribeJob(e: Entry, listId?: string) {
  return {
    data: {
      type: 'profile-subscription-bulk-create-job',
      attributes: {
        custom_source: 'Comfort Dial',
        profiles: { data: [{ type: 'profile', attributes: { phone_number: e164(e.phone), subscriptions: { sms: { marketing: { consent: 'SUBSCRIBED' } } } } }] }
      },
      ...(listId ? { relationships: { list: { data: { type: 'list', id: listId } } } } : {})
    }
  };
}

export function profileImport(e: Entry) {
  return {
    data: {
      type: 'profile',
      attributes: {
        phone_number: e164(e.phone),
        ...(e.first_name ? { first_name: e.first_name } : {}),
        ...(e.address ? { location: { address1: e.address, zip: e.zip, region: 'IL', country: 'United States' } } : {})
      }
    }
  };
}

async function post(env: unknown, path: string, payload: unknown) {
  const res = await fetch(`${API}/${path}/`, {
    method: 'POST',
    headers: {
      Authorization: `Klaviyo-API-Key ${envVar(env, 'KLAVIYO_PRIVATE_KEY')}`,
      revision: REVISION, accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`klaviyo ${path} ${res.status} ${(await res.text()).slice(0, 200)}`);
}

export async function sendWon(env: unknown, e: Entry, gift: Gift, cfg: Cfg) {
  await post(env, 'events', wonEvent(e, gift, cfg));
  if (e.sms_marketing) await post(env, 'profile-subscription-bulk-create-jobs', smsSubscribeJob(e, envVar(env, 'KLAVIYO_SMS_LIST_ID')));
}
export const sendRedeemed = (env: unknown, e: Entry, gift: Gift, now = new Date()) => post(env, 'events', redeemedEvent(e, gift, now));
/** A code voided in the admin: the reminder flow filters on this too, so a voided code gets no more reminders. */
export const sendVoided = (env: unknown, e: Entry, gift: Gift, now = new Date()) => post(env, 'events', redeemedEvent(e, gift, now, METRIC_VOIDED));
export const sendProfile = (env: unknown, e: Entry) => post(env, 'profile-import', profileImport(e));
