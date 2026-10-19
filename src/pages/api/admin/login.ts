import type { APIRoute } from 'astro';
import { authFor, dbFor, envOf } from '../../../lib/runtime.ts';
import { signIn } from '../../../lib/admin/service.ts';
import { sessionCookie, sessionSecret, signSession } from '../../../lib/admin/session.ts';
import { adminJson, isLocal, readBody } from '../../../lib/admin/http.ts';
import { clientIp } from '../../../lib/http.ts';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

/* POST /api/admin/login { email, password } → { ok, name } and the session cookie. See signIn for the throttle. */
export const POST: APIRoute = async (ctx) => {
  const env = envOf(ctx.locals);
  const db = dbFor(env), auth = authFor(env);
  if (!db || !auth) return adminJson({ error: 'The admin needs Supabase.' }, 503);
  const body = await readBody(ctx.request, 4000);
  if (!body) return adminJson({ error: 'Bad request.' }, 400);
  try {
    const res = await signIn(db, auth, { email: body.email, password: body.password, ip: clientIp(ctx.request, () => ctx.clientAddress) });
    if (!res.ok) return adminJson({ error: res.error }, res.status);
    const token = await signSession(res.session, sessionSecret(env));
    return adminJson({ ok: true, name: res.session.name }, 200, { 'set-cookie': sessionCookie(token, BASE, !isLocal(ctx.url)) });
  } catch (e) {
    console.error('dial admin login', e);
    return adminJson({ error: 'We couldn\'t check your password right now. Try again in a minute.' }, 502);
  }
};
