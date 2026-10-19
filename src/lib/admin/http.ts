/* Responses for the admin API: same-origin only (no CORS headers, unlike lib/http.ts), never cached, never framed. */
const SITE = ['https://www.alwaysreadyrepair.com', 'https://alwaysreadyrepair.com', 'https://always-ready-repair.webflow.io'];

export const SECURITY_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
  'referrer-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff'
};

export function adminJson(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extra } });
}

/** A state-changing request must come from the admin's own pages. The SameSite=Strict cookie already keeps other
 *  sites out; this is the second lock. Behind Webflow Cloud the Worker may see its own host rather than the site's,
 *  so the site's origins count as ours too. */
export function fromAdminPage(request: Request, url: URL): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return origin === url.origin || SITE.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export const isLocal = (url: URL) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);

export async function readBody(request: Request, max = 200_000): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > max) return null;
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}
