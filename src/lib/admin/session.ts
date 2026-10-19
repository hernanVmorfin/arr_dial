/* The admin's session: a cookie holding who signed in and until when, signed with HMAC-SHA256. The key is derived
 * from SUPABASE_SECRET_KEY, so there is no extra secret to set, and rotating that key signs everyone out. Locally
 * without Supabase the key is random per dev server, so a restart signs you out.
 * The cookie is HttpOnly, SameSite=Strict and scoped to the app's mount path; the middleware also checks the admin
 * is still on comfort_dial_admins on every request, so removing someone locks them out at once. */
import { envVar } from '../env.ts';

export type Session = { email: string; name: string; uid: string; exp: number };
export const COOKIE = 'arrd_admin';
export const SESSION_HOURS = 12;

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

let devSecret: string | null = null;
export function sessionSecret(env: unknown): string {
  const k = envVar(env, 'SUPABASE_SECRET_KEY') || envVar(env, 'SUPABASE_SERVICE_ROLE_KEY');
  if (k) return `arr-dial-admin-session-v1|${k}`;
  return (devSecret ||= `dev|${crypto.randomUUID()}|${crypto.randomUUID()}`);
}

async function hmacKey(secret: string) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(s: Session, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(s)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function readSession(token: string | undefined | null, secret: string, now = Date.now()): Promise<Session | null> {
  if (!token || token.length > 2000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(sig), enc.encode(body)))) return null;
    const s = JSON.parse(new TextDecoder().decode(unb64url(body))) as Session;
    if (typeof s.email !== 'string' || typeof s.exp !== 'number' || s.exp <= now) return null;
    return s;
  } catch { return null; }
}

/** Set-Cookie for the session, or to clear it (value null). */
export function sessionCookie(value: string | null, path: string, secure: boolean) {
  const parts = [`${COOKIE}=${value || ''}`, `Path=${path}`, 'HttpOnly', 'SameSite=Strict', `Max-Age=${value ? SESSION_HOURS * 3600 : 0}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function cookieValue(header: string | null, name = COOKIE): string | null {
  for (const part of (header || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}
