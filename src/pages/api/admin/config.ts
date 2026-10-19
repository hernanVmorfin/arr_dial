import type { APIRoute } from 'astro';
import { builtInConfig, dbFor, envOf } from '../../../lib/runtime.ts';
import { currentConfig, publishConfig } from '../../../lib/admin/service.ts';
import { adminJson, readBody } from '../../../lib/admin/http.ts';
import { clientIp } from '../../../lib/http.ts';

/* GET  /api/admin/config → { version, config, created_by, created_at, note }: the live config the editor starts from.
 * POST /api/admin/config { config, baseVersion, note } → { ok, version, warnings } or { error, errors } (400) or 409
 *      when someone else published since baseVersion. */
export const GET: APIRoute = async ({ locals }) => {
  try { return adminJson(await currentConfig(dbFor(envOf(locals))!, builtInConfig())); }
  catch (e) { console.error('dial admin config', e); return adminJson({ error: 'Couldn\'t load the config.' }, 502); }
};

export const POST: APIRoute = async (ctx) => {
  const db = dbFor(envOf(ctx.locals))!;
  const body = await readBody(ctx.request);
  if (!body) return adminJson({ error: 'Bad request.' }, 400);
  try {
    const res = await publishConfig(db, builtInConfig(), {
      config: body.config, baseVersion: body.baseVersion, note: body.note, by: ctx.locals.admin!.email, ip: clientIp(ctx.request, () => ctx.clientAddress)
    });
    if (!res.ok) return adminJson({ error: res.error, errors: res.errors, warnings: res.warnings }, res.status);
    return adminJson({ ok: true, version: res.version, config: res.config, warnings: res.warnings });
  } catch (e) {
    console.error('dial admin publish', e);
    return adminJson({ error: 'Publishing failed on our end. Nothing changed. Try again in a minute.' }, 502);
  }
};
