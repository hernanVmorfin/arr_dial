import type { APIRoute } from 'astro';
import { sessionCookie } from '../../../lib/admin/session.ts';
import { adminJson, isLocal } from '../../../lib/admin/http.ts';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

/* POST /api/admin/logout → clears the session cookie. */
export const POST: APIRoute = ({ url }) => adminJson({ ok: true }, 200, { 'set-cookie': sessionCookie(null, BASE, !isLocal(url)) });
