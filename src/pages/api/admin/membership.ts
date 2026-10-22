import type { APIRoute } from 'astro';
import { configFor, dbFor, envOf } from '../../../lib/runtime.ts';
import { freeYears } from '../../../lib/admin/service.ts';
import { adminJson } from '../../../lib/admin/http.ts';

/* GET /api/admin/membership → { month, rows: [{ month, state, held_until, claimed_at, entry }] }
 *     Each month's free year as stored in comfort_dial_memberships: won (entry is the code it went to), held on
 *     someone's claim screen right now, or free again after a hold ran out. Months nobody has turned for have no row. */
export const GET: APIRoute = async ({ locals }) => {
  const db = dbFor(envOf(locals))!;
  try { return adminJson(await freeYears(db, await configFor(db))); }
  catch (e) { console.error('dial admin membership', e); return adminJson({ error: 'Couldn\'t load the free-year schedule.' }, 502); }
};
