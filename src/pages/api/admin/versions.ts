import type { APIRoute } from 'astro';
import { builtInConfig, dbFor, envOf } from '../../../lib/runtime.ts';
import { cleanConfig } from '../../../lib/admin/service.ts';
import { adminJson } from '../../../lib/admin/http.ts';

/* GET /api/admin/versions → { versions }: the last 50 published configs, newest first, ending with the built-in one
 * (version 0) once fewer than 50 have been published. */
export const GET: APIRoute = async ({ locals }) => {
  try {
    const rows = await dbFor(envOf(locals))!.configVersions(50);
    const versions = rows.length < 50 ? [...rows, { version: 0, config: cleanConfig(builtInConfig()), note: 'Built-in starting config (data/dial.json)', created_by: 'code', created_at: null }] : rows;
    return adminJson({ versions });
  } catch (e) { console.error('dial admin versions', e); return adminJson({ error: 'Couldn\'t load the history.' }, 502); }
};
