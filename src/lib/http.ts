/* JSON responses, CORS and the visitor's IP. On Webflow Cloud the popup and the API share alwaysreadyrepair.com, so
 * CORS only matters if the app is ever served from another host (staging, or a plain Worker as a fallback). */
const ALLOWED = [
  'https://www.alwaysreadyrepair.com', 'https://alwaysreadyrepair.com', 'https://always-ready-repair.webflow.io'
];
const allowed = (origin: string | null) => !!origin && (ALLOWED.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  return allowed(origin) ? { 'access-control-allow-origin': origin!, vary: 'Origin' } : {};
}

export function json(request: Request, data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(request), ...extra }
  });
}

export function preflight(request: Request) {
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders(request), 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' }
  });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > 8000) return null;
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

/** The visitor's IP: Cloudflare's header first, then the proxy chain, then Astro's view of the socket. */
export function clientIp(request: Request, clientAddress: () => string | undefined): string | null {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.slice(0, 64);
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim().slice(0, 64) || null;
  try { return clientAddress() || null; } catch { return null; }
}
