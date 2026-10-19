/* Guards the admin: <base>admin/* pages and <base>api/admin/* calls. Everything else passes straight through.
 * A request gets in with a valid session cookie for someone still on comfort_dial_admins (checked every time, so
 * removing an admin locks them out at once). The sign-in page and the sign-in call are the only open doors.
 * Pages without a session go to the sign-in page; API calls get 401. Writes must come from the admin's own pages. */
import { defineMiddleware } from 'astro:middleware';
import { dbFor, envOf } from './lib/runtime.ts';
import { COOKIE, cookieValue, readSession, sessionCookie, sessionSecret } from './lib/admin/session.ts';
import { adminJson, fromAdminPage, isLocal, SECURITY_HEADERS } from './lib/admin/http.ts';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname;
  const page = path === `${BASE}admin` || path.startsWith(`${BASE}admin/`);
  const api = path.startsWith(`${BASE}api/admin/`);
  if (!page && !api) return next();

  const open = path === `${BASE}admin/login` || path === `${BASE}api/admin/login`;
  if (api && ctx.request.method !== 'GET' && !fromAdminPage(ctx.request, ctx.url)) return adminJson({ error: 'Not from the admin.' }, 403);

  const env = envOf(ctx.locals);
  const db = dbFor(env);
  if (!db) {
    return api ? adminJson({ error: 'The admin needs Supabase. Set SUPABASE_URL and SUPABASE_SECRET_KEY.' }, 503)
      : new Response('The Comfort Dial admin needs Supabase: set SUPABASE_URL and SUPABASE_SECRET_KEY.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS } });
  }

  const s = await readSession(cookieValue(ctx.request.headers.get('cookie'), COOKIE), sessionSecret(env));
  let admin = null;
  if (s) {
    try { admin = await db.admin(s.email); }
    catch (e) { console.error('dial admin check', e); return adminJson({ error: 'Couldn\'t reach the database. Try again in a minute.' }, 502); }
  }
  if (admin && s) ctx.locals.admin = { email: admin.email, name: admin.name, uid: s.uid };

  if (!ctx.locals.admin && !open) {
    const clear: Record<string, string> = s ? { 'set-cookie': sessionCookie(null, BASE, !isLocal(ctx.url)) } : {};
    if (api) return adminJson({ error: 'Sign in again.', reason: 'signed_out' }, 401, clear);
    const back = path === `${BASE}admin` || path === `${BASE}admin/` ? '' : `?next=${encodeURIComponent(path)}`;
    return new Response(null, { status: 302, headers: { location: `${BASE}admin/login${back}`, ...SECURITY_HEADERS, ...clear } });
  }

  const res = await next();
  try { for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v); return res; }
  catch {   // immutable headers (a redirect, say): copy the response
    const copy = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) copy.headers.set(k, v);
    return copy;
  }
});
