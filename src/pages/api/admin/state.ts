import type { APIRoute } from 'astro';
import { builtInConfig, dbFor, envOf } from '../../../lib/runtime.ts';
import { setDialEnabled } from '../../../lib/admin/service.ts';
import { adminJson, readBody } from '../../../lib/admin/http.ts';
import { clientIp } from '../../../lib/http.ts';

/* POST /api/admin/state { enabled } → { ok, version, config }: pause or resume the dial at once. Publishes the live
 * config with only `enabled` changed, so a draft someone is editing is left alone. */
export const POST: APIRoute = async (ctx) => {
  const body = await readBody(ctx.request, 1000);
  if (!body) return adminJson({ error: 'Bad request.' }, 400);
  try {
    const res = await setDialEnabled(dbFor(envOf(ctx.locals))!, builtInConfig(), { enabled: body.enabled, by: ctx.locals.admin!.email, ip: clientIp(ctx.request, () => ctx.clientAddress) });
    if (!res.ok) return adminJson({ error: res.error }, res.status);
    return adminJson({ ok: true, version: res.version, config: res.config });
  } catch (e) {
    console.error('dial admin state', e);
    return adminJson({ error: 'That didn\'t go through. Try again in a minute.' }, 502);
  }
};
