import type { APIRoute } from 'astro';
import { builtInConfig, dbFor, envOf } from '../../../lib/runtime.ts';
import { rollbackTo } from '../../../lib/admin/service.ts';
import { adminJson, readBody } from '../../../lib/admin/http.ts';
import { clientIp } from '../../../lib/http.ts';

/* POST /api/admin/rollback { version, baseVersion } → { ok, version, config }: publishes an old version again. */
export const POST: APIRoute = async (ctx) => {
  const body = await readBody(ctx.request, 1000);
  if (!body) return adminJson({ error: 'Bad request.' }, 400);
  try {
    const res = await rollbackTo(dbFor(envOf(ctx.locals))!, builtInConfig(), { version: body.version, baseVersion: body.baseVersion, by: ctx.locals.admin!.email, ip: clientIp(ctx.request, () => ctx.clientAddress) });
    if (!res.ok) return adminJson({ error: res.error, errors: res.errors }, res.status);
    return adminJson({ ok: true, version: res.version, config: res.config, warnings: res.warnings });
  } catch (e) {
    console.error('dial admin rollback', e);
    return adminJson({ error: 'The restore failed on our end. Nothing changed.' }, 502);
  }
};
