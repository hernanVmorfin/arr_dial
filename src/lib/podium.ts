/* Podium texts each new winner their code from ARR's number, so a reply lands with the office where CSRs work.
 * A phone can win only once (unique in comfort_dial_entries) and repeat claims send nothing, so the dial itself texts
 * a given number once. An admin can resend it (a customer lost the text), at most 3 times a day per code, logged.
 * The copy is fixed; the only visitor-supplied value is the phone itself.
 *
 * Signing in. Podium's API is OAuth 2: an access token lasts hours (10, by Podium's docs) and a refresh token gets a
 * new one. With PODIUM_CLIENT_ID, PODIUM_CLIENT_SECRET and PODIUM_REFRESH_TOKEN set ('oauth'), a send uses this
 * isolate's token while it has more than 5 minutes left, else the newest pair in Supabase (comfort_dial_oauth, shared
 * by every isolate), else one refresh that parallel sends wait on together. The new pair goes back to Supabase, so a
 * refresh token Podium hands back is never lost. A token Podium turns away early (401) gets one refresh and one retry.
 * Without those three, PODIUM_API_TOKEN is sent as it is ('static', the pricing app's token, which stops working when
 * Podium expires it). In 'oauth' mode it is the last resort when a refresh fails. */
import { chicagoDate } from './rules.js';
import { envVar } from './env.ts';
import type { Entry, OAuthToken, TokenStore } from './db.ts';
import type { Cfg, Gift } from './dial.ts';

const MESSAGES_URL = 'https://api.podium.com/v4/messages';
const TOKEN_URL = 'https://api.podium.com/oauth/token';
const PROVIDER = 'podium';
const EARLY_MS = 5 * 60e3;   // refresh this long before the token runs out
const GUESS_MS = 3600e3;     // lifetime assumed when Podium's answer gives none (see expiry)

type Io = { fetcher?: typeof fetch; now?: Date };
type Live = { access: string; refresh: string; expiresAt: number };

/* This isolate's token, and the refresh in progress: at most one, and parallel sends wait on it together. */
let held: Live | null = null;
let refreshing: Promise<Live> | null = null;
/** Tests: start from a cold isolate. */
export function forgetPodiumToken() { held = null; refreshing = null; }

export type PodiumMode = 'oauth' | 'static' | 'none';
export function podiumMode(env: unknown): PodiumMode {
  if (envVar(env, 'PODIUM_CLIENT_ID') && envVar(env, 'PODIUM_CLIENT_SECRET') && envVar(env, 'PODIUM_REFRESH_TOKEN')) return 'oauth';
  return envVar(env, 'PODIUM_API_TOKEN') ? 'static' : 'none';
}
export const podiumConfigured = (env: unknown) => podiumMode(env) !== 'none' && !!envVar(env, 'PODIUM_LOCATION_UID');

export function codeText(e: Entry, gift: Gift, cfg: Cfg) {
  const date = chicagoDate(e.expires_at).replace(/, \d{4}$/, '');
  return `Always Ready Repair: your Comfort Dial gift is ${gift.name}. Code ${e.code}, good through ${date}. Call or text ${cfg.phone} to book and give the code.`;
}

export async function sendCodeText(env: unknown, store: TokenStore | null, e: Entry, gift: Gift, cfg: Cfg, io: Io = {}) {
  const fetcher = io.fetcher || fetch;
  const body = JSON.stringify({ locationUid: envVar(env, 'PODIUM_LOCATION_UID'), channel: { type: 'phone', identifier: e.phone }, body: codeText(e, gift, cfg) });
  const post = (token: string) => fetcher(MESSAGES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body,
    signal: AbortSignal.timeout(8000)
  });
  let auth = await bearer(env, store, io);
  let res = await post(auth.token);
  if (res.status === 401 && auth.oauth) {
    // Podium ended the token before its time: refresh past it, once.
    await res.body?.cancel();
    auth = await bearer(env, store, io, auth.token);
    res = await post(auth.token);
  }
  if (!res.ok) throw new Error(`podium ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function bearer(env: unknown, store: TokenStore | null, io: Io, refused?: string) {
  const fixed = envVar(env, 'PODIUM_API_TOKEN');
  if (podiumMode(env) !== 'oauth') return { token: fixed || '', oauth: false };
  try { return { token: await podiumAccessToken(env, store, io, refused), oauth: true }; }
  catch (err) {
    if (!fixed) throw err;
    console.error('dial podium refresh failed, sending with PODIUM_API_TOKEN', err);
    return { token: fixed, oauth: false };
  }
}

/** The token if it has more than EARLY_MS left and isn't the one Podium refused, else null. */
const fresh = (t: Live | null, now: number, refused?: string) => (t && t.access !== refused && t.expiresAt - EARLY_MS > now ? t : null);

/** A live access token in 'oauth' mode. `refused`: one Podium just turned away, never handed out again. */
export async function podiumAccessToken(env: unknown, store: TokenStore | null, io: Io = {}, refused?: string) {
  const now = (io.now || new Date()).getTime();
  const mine = fresh(held, now, refused);
  if (mine) return mine.access;
  refreshing ||= renew(env, store, io.fetcher || fetch, now, refused).finally(() => { refreshing = null; });
  return (await refreshing).access;
}

/* The shared pair when another isolate has refreshed already, else a refresh. Refresh tokens go newest first: the
 * shared one, this isolate's, then the env's (where a new authorization lands). A refused one may have just been
 * spent by another isolate, so the shared pair is read again before the next one is tried. */
async function renew(env: unknown, store: TokenStore | null, fetcher: typeof fetch, now: number, refused?: string): Promise<Live> {
  const shared = async () => {
    if (!store) return null;
    try { return fromRow(await store.oauthToken(PROVIDER)); }
    catch (err) { console.error('dial podium token read', err); return null; }
  };
  const first = await shared();
  const ready = fresh(first, now, refused);
  if (ready) return (held = ready);
  const tried = new Set<string>();
  let failure: Error | null = null;
  for (const refresh of [first?.refresh, held?.refresh, envVar(env, 'PODIUM_REFRESH_TOKEN')]) {
    if (!refresh || tried.has(refresh)) continue;
    tried.add(refresh);
    const res = await fetcher(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: envVar(env, 'PODIUM_CLIENT_ID'), client_secret: envVar(env, 'PODIUM_CLIENT_SECRET'), grant_type: 'refresh_token', refresh_token: refresh }),
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const r = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: unknown };
      if (!r.access_token) throw new Error('podium token: no access_token in the answer');
      const next: Live = { access: r.access_token, refresh: r.refresh_token || refresh, expiresAt: expiry(r.access_token, r.expires_in, now) };
      held = next;
      if (store) await store.saveOAuthToken(toRow(next, now)).catch((err) => console.error('dial podium token save', err));
      return next;
    }
    failure = new Error(`podium token ${res.status} ${(await res.text()).slice(0, 200)}`);
    if (res.status === 429 || res.status >= 500) break;   // Podium is struggling, not refusing this token
    const theirs = fresh(await shared(), now, refused);
    if (theirs) return (held = theirs);
  }
  throw failure || new Error('podium token: no refresh token to try');
}

/* Podium's docs give access tokens 10 hours, but their sample answer has no expires_in. So: expires_in when it's
 * there, else the token's own exp if it is a JWT, else an hour. Refreshing early costs a call; late costs a text. */
function expiry(access: string, expiresIn: unknown, now: number) {
  const s = Number(expiresIn);
  if (Number.isFinite(s) && s > 0) return now + s * 1000;
  return jwtExpiry(access) ?? now + GUESS_MS;
}

/** When a JWT expires (ms), or null when the token isn't a JWT with an exp. */
export function jwtExpiry(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const exp = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))?.exp;
    return typeof exp === 'number' && exp > 0 ? exp * 1000 : null;
  } catch { return null; }
}

const fromRow = (r: OAuthToken | null): Live | null => r && { access: r.access_token, refresh: r.refresh_token, expiresAt: Date.parse(r.expires_at) };
const toRow = (t: Live, now: number): OAuthToken => ({
  provider: PROVIDER, access_token: t.access, refresh_token: t.refresh, expires_at: new Date(t.expiresAt).toISOString(), updated_at: new Date(now).toISOString()
});

/** For /api/health: how texts sign in to Podium, and when that token expires (null: not known yet). With a store
 *  (?deep=1), the shared pair in Supabase; otherwise this isolate's copy. Never refreshes. */
export async function podiumAuth(env: unknown, store: TokenStore | null) {
  const mode = podiumMode(env);
  const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);
  if (mode === 'static') return { mode, expiresAt: iso(jwtExpiry(envVar(env, 'PODIUM_API_TOKEN')!)) };
  if (mode === 'none' || !store) return { mode, expiresAt: iso(held?.expiresAt) };
  try {
    const row = await store.oauthToken(PROVIDER);
    return { mode, expiresAt: row?.expires_at ?? null, refreshedAt: row?.updated_at ?? null };
  } catch { return { mode, expiresAt: null, refreshedAt: null, error: 'comfort_dial_oauth could not be read' }; }
}
