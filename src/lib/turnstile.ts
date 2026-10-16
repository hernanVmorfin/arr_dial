/* Cloudflare Turnstile: an invisible check on each turn, so a script can't hammer the dial to grab a month's free
 * year. Skipped when TURNSTILE_SECRET_KEY isn't set (local dev, or before the key exists). */
export async function verifyTurnstile(secret: string, token: unknown, ip: string | null): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    const j: any = await res.json();
    return j?.success === true;
  } catch { return false; }
}
