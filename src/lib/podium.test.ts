import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Cfg } from './dial.ts';
import type { Entry } from './db.ts';
import { memoryDb } from './db-memory.ts';
import { supabaseDb } from './db-supabase.ts';
import { forgetPodiumToken, jwtExpiry, podiumAuth, podiumConfigured, podiumMode, sendCodeText } from './podium.ts';

const cfg: Cfg = JSON.parse(readFileSync(new URL('../../data/dial.json', import.meta.url), 'utf8'));
const gift = cfg.gifts.find((g) => g.id === 'svc20')!;
const entry = { id: 'e1', code: 'SVC20-7K3PK', phone: '7085550142', gift: 'svc20', expires_at: '2026-11-15T15:00:00.000Z' } as Entry;
const T0 = new Date('2026-10-19T15:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const HOUR = 3600e3;
const OAUTH = { PODIUM_CLIENT_ID: 'cid', PODIUM_CLIENT_SECRET: 'secret', PODIUM_REFRESH_TOKEN: 'r-env', PODIUM_LOCATION_UID: 'loc-1' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

/* Podium, faked: the token endpoint answers a{n}/r{n+1} for 10 hours unless `token` says otherwise; messages take
 * any token unless `message` says otherwise. Each call waits a tick, like a real round trip, so parallel sends overlap. */
function fakePodium(o: { token?: (refresh: string, n: number) => Response; message?: (bearer: string) => Response } = {}) {
  const tokenCalls: Record<string, string>[] = [], sent: string[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, 1));
    const body = JSON.parse(String(init?.body));
    if (String(url) === 'https://api.podium.com/oauth/token') {
      tokenCalls.push(body);
      const n = tokenCalls.length;
      return o.token ? o.token(body.refresh_token, n) : json({ access_token: `a${n}`, refresh_token: `r${n + 1}`, expires_in: 36000 });
    }
    if (String(url) === 'https://api.podium.com/v4/messages') {
      const bearer = String((init!.headers as Record<string, string>).Authorization).replace(/^Bearer /, '');
      sent.push(bearer);
      assert.equal(body.locationUid, 'loc-1');
      assert.deepEqual(body.channel, { type: 'phone', identifier: '7085550142' });
      return o.message ? o.message(bearer) : json({ data: { uid: 'm1' } });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return { fetcher, tokenCalls, sent };
}

const quiet = <T>(fn: () => Promise<T>) => async () => {
  const err = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = err; }
};

beforeEach(() => forgetPodiumToken());

test('Podium: which keys turn texting on, and how it signs in', () => {
  assert.equal(podiumMode(OAUTH), 'oauth');
  assert.equal(podiumMode({ ...OAUTH, PODIUM_REFRESH_TOKEN: '', PODIUM_API_TOKEN: 'static' }), 'static');
  assert.equal(podiumMode({ PODIUM_LOCATION_UID: 'loc-1' }), 'none');
  assert.equal(podiumConfigured(OAUTH), true);
  assert.equal(podiumConfigured({ podium_api_token: 'static', PODIUM_LOCATION_UID: 'loc-1' }), true);
  assert.equal(podiumConfigured({ PODIUM_API_TOKEN: 'static' }), false, 'no location, no texts');
});

test('Podium: without the OAuth keys the static token is sent as it is', async () => {
  const p = fakePodium();
  await sendCodeText({ PODIUM_API_TOKEN: 'static-1', PODIUM_LOCATION_UID: 'loc-1' }, memoryDb(), entry, gift, cfg, { fetcher: p.fetcher, now: T0 });
  assert.deepEqual(p.sent, ['static-1']);
  assert.equal(p.tokenCalls.length, 0);
});

test('Podium: refreshes when the token runs out, keeps it until then, and stores the newest pair', async () => {
  const db = memoryDb(), p = fakePodium();
  const send = (now: Date) => sendCodeText(OAUTH, db, entry, gift, cfg, { fetcher: p.fetcher, now });
  await send(T0);
  assert.deepEqual(p.tokenCalls, [{ client_id: 'cid', client_secret: 'secret', grant_type: 'refresh_token', refresh_token: 'r-env' }]);
  assert.deepEqual(p.sent, ['a1']);
  assert.deepEqual(db.oauthRows, [{ provider: 'podium', access_token: 'a1', refresh_token: 'r2', expires_at: at(10 * HOUR).toISOString(), updated_at: T0.toISOString() }]);

  await send(at(9 * HOUR));
  assert.equal(p.tokenCalls.length, 1, 'still good for an hour: no refresh');

  await send(at(10 * HOUR - 4 * 60e3));
  assert.equal(p.tokenCalls.length, 2, 'refreshed 5 minutes early');
  assert.equal(p.tokenCalls[1].refresh_token, 'r2', 'with the refresh token Podium handed back, not the env one');
  assert.deepEqual(p.sent, ['a1', 'a1', 'a2']);
  assert.equal(db.oauthRows[0].refresh_token, 'r3');
});

test('Podium: parallel sends share one refresh', async () => {
  const db = memoryDb(), p = fakePodium();
  await Promise.all(Array.from({ length: 5 }, () => sendCodeText(OAUTH, db, entry, gift, cfg, { fetcher: p.fetcher, now: T0 })));
  assert.equal(p.tokenCalls.length, 1);
  assert.deepEqual(p.sent, ['a1', 'a1', 'a1', 'a1', 'a1']);
});

test('Podium: a fresh pair another isolate stored is used without refreshing', async () => {
  const db = memoryDb(), p = fakePodium();
  await db.saveOAuthToken({ provider: 'podium', access_token: 'shared', refresh_token: 'r-shared', expires_at: at(5 * HOUR).toISOString(), updated_at: T0.toISOString() });
  await sendCodeText(OAUTH, db, entry, gift, cfg, { fetcher: p.fetcher, now: T0 });
  assert.deepEqual(p.sent, ['shared']);
  assert.equal(p.tokenCalls.length, 0);
});

test('Podium: a refresh token Podium refuses gives way to the one in the env', quiet(async () => {
  const db = memoryDb();
  await db.saveOAuthToken({ provider: 'podium', access_token: 'old', refresh_token: 'r-dead', expires_at: at(-HOUR).toISOString(), updated_at: T0.toISOString() });
  const p = fakePodium({ token: (r, n) => (r === 'r-dead' ? json({ error: 'invalid_grant' }, 400) : json({ access_token: `a${n}`, refresh_token: 'r-new', expires_in: 36000 })) });
  await sendCodeText(OAUTH, db, entry, gift, cfg, { fetcher: p.fetcher, now: T0 });
  assert.deepEqual(p.tokenCalls.map((c) => c.refresh_token), ['r-dead', 'r-env']);
  assert.deepEqual(p.sent, ['a2']);
  assert.equal(db.oauthRows[0].refresh_token, 'r-new');
}));

test('Podium: a refused refresh picks up the pair another isolate just stored', quiet(async () => {
  const db = memoryDb();
  await db.saveOAuthToken({ provider: 'podium', access_token: 'old', refresh_token: 'r1', expires_at: at(-HOUR).toISOString(), updated_at: T0.toISOString() });
  // Another isolate spends r1 first: Podium refuses ours, and their pair is already in Supabase.
  const p = fakePodium({ token: () => {
    void db.saveOAuthToken({ provider: 'podium', access_token: 'theirs', refresh_token: 'r2', expires_at: at(10 * HOUR).toISOString(), updated_at: T0.toISOString() });
    return json({ error: 'invalid_grant' }, 400);
  } });
  await sendCodeText(OAUTH, db, entry, gift, cfg, { fetcher: p.fetcher, now: T0 });
  assert.equal(p.tokenCalls.length, 1, 'no second refresh, the env token is never spent');
  assert.deepEqual(p.sent, ['theirs']);
}));

test('Podium: a 401 on send refreshes once and sends again', async () => {
  // The second text goes out on a1 with hours left, and Podium turns it away.
  let texts = 0;
  const db = memoryDb(), p = fakePodium({ message: () => (++texts === 2 ? json({ message: 'expired' }, 401) : json({})) });
  await sendCodeText(OAUTH, db, entry, gift, cfg, { fetcher: p.fetcher, now: T0 });
  await sendCodeText(OAUTH, db, entry, gift, cfg, { fetcher: p.fetcher, now: at(HOUR) });
  assert.deepEqual(p.sent, ['a1', 'a1', 'a2']);
  assert.equal(p.tokenCalls.length, 2);
  assert.equal(db.oauthRows[0].access_token, 'a2');

  const always401 = fakePodium({ message: () => json({ message: 'nope' }, 401) });
  forgetPodiumToken();
  await assert.rejects(sendCodeText(OAUTH, memoryDb(), entry, gift, cfg, { fetcher: always401.fetcher, now: T0 }), /podium 401/);
  assert.equal(always401.sent.length, 2, 'one retry, not a loop');
});

test('Podium: when every refresh fails, PODIUM_API_TOKEN is the last resort', quiet(async () => {
  const refused = () => fakePodium({ token: () => json({ error: 'invalid_grant' }, 400) });
  const p = refused();
  await sendCodeText({ ...OAUTH, PODIUM_API_TOKEN: 'static-1' }, memoryDb(), entry, gift, cfg, { fetcher: p.fetcher, now: T0 });
  assert.deepEqual(p.sent, ['static-1']);

  const q = refused();
  await assert.rejects(sendCodeText(OAUTH, memoryDb(), entry, gift, cfg, { fetcher: q.fetcher, now: T0 }), /podium token 400/);
  assert.equal(q.sent.length, 0);

  // Podium down (5xx): the env token isn't tried after the stored one, it would fail the same way.
  const db = memoryDb();
  await db.saveOAuthToken({ provider: 'podium', access_token: 'old', refresh_token: 'r-stored', expires_at: at(-HOUR).toISOString(), updated_at: T0.toISOString() });
  const down = fakePodium({ token: () => json({}, 503) });
  await assert.rejects(sendCodeText(OAUTH, db, entry, gift, cfg, { fetcher: down.fetcher, now: T0 }), /podium token 503/);
  assert.equal(down.tokenCalls.length, 1);
}));

test('Podium: expiry from expires_in, else the JWT\'s exp, else an hour', async () => {
  const exp = Math.floor(at(7 * HOUR).getTime() / 1000);
  for (const [answer, expires] of [
    [{ access_token: 'a', expires_in: 120 * 60 }, at(2 * HOUR)],
    [{ access_token: jwt({ exp }) }, at(7 * HOUR)],
    [{ access_token: 'opaque' }, at(HOUR)]
  ] as const) {
    forgetPodiumToken();
    const db = memoryDb(), p = fakePodium({ token: () => json(answer) });
    await sendCodeText(OAUTH, db, entry, gift, cfg, { fetcher: p.fetcher, now: T0 });
    assert.equal(db.oauthRows[0].expires_at, expires.toISOString());
    assert.equal(db.oauthRows[0].refresh_token, 'r-env', 'no refresh token in the answer: keep the one sent');
  }
  assert.equal(jwtExpiry('not-a-jwt'), null);
  assert.equal(jwtExpiry('h.%%%.s'), null);
});

test('Podium: health shows the mode and when the token expires, and never refreshes', async () => {
  const exp = Math.floor(at(3 * HOUR).getTime() / 1000);
  assert.deepEqual(await podiumAuth({ PODIUM_API_TOKEN: jwt({ exp }) }, null), { mode: 'static', expiresAt: at(3 * HOUR).toISOString() });
  assert.deepEqual(await podiumAuth({ PODIUM_API_TOKEN: 'opaque' }, null), { mode: 'static', expiresAt: null });
  assert.deepEqual(await podiumAuth({}, null), { mode: 'none', expiresAt: null });

  const db = memoryDb();
  assert.deepEqual(await podiumAuth(OAUTH, db), { mode: 'oauth', expiresAt: null, refreshedAt: null });
  assert.deepEqual(await podiumAuth(OAUTH, null), { mode: 'oauth', expiresAt: null });
  await sendCodeText(OAUTH, db, entry, gift, cfg, { fetcher: fakePodium().fetcher, now: T0 });
  assert.deepEqual(await podiumAuth(OAUTH, db), { mode: 'oauth', expiresAt: at(10 * HOUR).toISOString(), refreshedAt: T0.toISOString() });
  assert.deepEqual(await podiumAuth(OAUTH, null), { mode: 'oauth', expiresAt: at(10 * HOUR).toISOString() });
});

test('Supabase: the Podium pair is upserted by provider, and a missing table reads as no pair', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return init?.method === 'GET' ? new Response('{"code":"PGRST205"}', { status: 404 }) : new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  const db = supabaseDb({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x' }, fetcher);
  assert.equal(await db.oauthToken('podium'), null);
  assert.match(calls[0].url, /\/rest\/v1\/comfort_dial_oauth\?select=\*&provider=eq\.podium$/);
  await db.saveOAuthToken({ provider: 'podium', access_token: 'a', refresh_token: 'r', expires_at: T0.toISOString(), updated_at: T0.toISOString() });
  assert.match(calls[1].url, /comfort_dial_oauth\?on_conflict=provider$/);
  assert.equal((calls[1].init!.headers as Record<string, string>).Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.equal(JSON.parse(String(calls[1].init!.body)).refresh_token, 'r');
});
