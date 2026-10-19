import type { APIRoute } from 'astro';
import { authFor, dbFor, envOf } from '../../../lib/runtime.ts';
import { changePassword } from '../../../lib/admin/service.ts';
import { adminJson, readBody } from '../../../lib/admin/http.ts';
import { clientIp } from '../../../lib/http.ts';

/* POST /api/admin/password { current, next } → { ok }: change your own password. */
export const POST: APIRoute = async (ctx) => {
  const env = envOf(ctx.locals);
  const body = await readBody(ctx.request, 2000);
  if (!body) return adminJson({ error: 'Bad request.' }, 400);
  const a = ctx.locals.admin!;
  try {
    const res = await changePassword(dbFor(env)!, authFor(env)!, { session: { ...a, exp: 0 }, current: body.current, next: body.next, ip: clientIp(ctx.request, () => ctx.clientAddress) });
    return res.ok ? adminJson(res) : adminJson({ error: res.error }, res.status);
  } catch (e) { console.error('dial admin password', e); return adminJson({ error: 'Couldn\'t change it. Try again in a minute.' }, 502); }
};
