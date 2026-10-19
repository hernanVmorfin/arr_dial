import type { APIRoute } from 'astro';
import { authFor, dbFor, envOf } from '../../../lib/runtime.ts';
import { addAdmin, removeAdmin } from '../../../lib/admin/service.ts';
import { adminJson, readBody } from '../../../lib/admin/http.ts';
import { clientIp } from '../../../lib/http.ts';

/* GET    /api/admin/team → { admins: [{ email, name, created_at, created_by, lastLogin }] }
 * POST   /api/admin/team { email, name, password } → { ok, existingAccount }
 *        Creates their Supabase Auth account with the temporary password. If the email already has an account in the
 *        project (the pricing app, say), it is only added to the list and keeps its own password.
 * DELETE /api/admin/team { email } → { ok }. Their Supabase account stays; they just can't get into the dial admin. */
export const GET: APIRoute = async ({ locals }) => {
  const db = dbFor(envOf(locals))!;
  try {
    const [admins, logins] = await Promise.all([db.admins(), db.lastLogins()]);
    return adminJson({ admins: admins.map((a) => ({ ...a, lastLogin: logins[a.email] || null })) });
  } catch (e) { console.error('dial admin team', e); return adminJson({ error: 'Couldn\'t load the team.' }, 502); }
};

export const POST: APIRoute = async (ctx) => {
  const env = envOf(ctx.locals);
  const body = await readBody(ctx.request, 4000);
  if (!body) return adminJson({ error: 'Bad request.' }, 400);
  try {
    const res = await addAdmin(dbFor(env)!, authFor(env)!, { email: body.email, name: body.name, password: body.password, by: ctx.locals.admin!.email, ip: clientIp(ctx.request, () => ctx.clientAddress) });
    return res.ok ? adminJson(res) : adminJson({ error: res.error }, res.status);
  } catch (e) { console.error('dial admin add', e); return adminJson({ error: 'Couldn\'t add them. Try again in a minute.' }, 502); }
};

export const DELETE: APIRoute = async (ctx) => {
  const body = await readBody(ctx.request, 1000);
  if (!body) return adminJson({ error: 'Bad request.' }, 400);
  try {
    const res = await removeAdmin(dbFor(envOf(ctx.locals))!, { email: body.email, by: ctx.locals.admin!.email, ip: clientIp(ctx.request, () => ctx.clientAddress) });
    return res.ok ? adminJson(res) : adminJson({ error: res.error }, res.status);
  } catch (e) { console.error('dial admin remove', e); return adminJson({ error: 'Couldn\'t remove them. Try again in a minute.' }, 502); }
};
