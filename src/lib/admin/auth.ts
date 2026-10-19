/* Admin passwords live in Supabase Auth (the same project as the dial's tables), so this app never stores or hashes
 * one. Supabase checks the password; comfort_dial_admins decides who is an admin. The calls use the server-only
 * secret key and never leave the Worker. memoryAuth stands in for tests and `astro dev` without Supabase. */
import { authHeaders, supabaseConfig } from '../db-supabase.ts';

export type AuthUser = { id: string; email: string };
export interface PasswordAuth {
  /** The user when the email and password match, null when they don't. Throws when Supabase can't be reached. */
  signIn(email: string, password: string): Promise<AuthUser | null>;
  /** 'exists' when the email already has an account in this Supabase project: its password is left alone. */
  createUser(email: string, password: string): Promise<'created' | 'exists'>;
  setPassword(userId: string, password: string): Promise<void>;
}

const TIMEOUT_MS = 6000;

export function supabaseAuth(env: unknown, fetcher: typeof fetch = fetch): PasswordAuth {
  const c = supabaseConfig(env);
  if (!c) throw new Error('Supabase is not configured');
  const call = (method: string, path: string, body: unknown) => fetcher(`${c.url}/auth/v1/${path}`, {
    method, headers: { ...authHeaders(c.key), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  return {
    async signIn(email, password) {
      const res = await call('POST', 'token?grant_type=password', { email, password });
      if (res.ok) {
        const j: any = await res.json();
        return j?.user?.id ? { id: String(j.user.id), email: String(j.user.email || email).toLowerCase() } : null;
      }
      if (res.status === 400 || res.status === 401 || res.status === 422) return null;   // wrong password, unknown or unconfirmed email
      throw new Error(`supabase auth ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async createUser(email, password) {
      const res = await call('POST', 'admin/users', { email, password, email_confirm: true });
      if (res.ok) return 'created';
      const text = await res.text();
      if (res.status === 422 && /exist|already/i.test(text)) return 'exists';
      throw new Error(`supabase create user ${res.status} ${text.slice(0, 200)}`);
    },
    async setPassword(userId, password) {
      const res = await call('PUT', `admin/users/${encodeURIComponent(userId)}`, { password });
      if (!res.ok) throw new Error(`supabase set password ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  };
}

export function memoryAuth(seed: Record<string, string> = {}): PasswordAuth & { passwords: Map<string, string> } {
  const passwords = new Map(Object.entries(seed).map(([e, p]) => [e.toLowerCase(), p]));
  return {
    passwords,
    async signIn(email, password) {
      const e = email.toLowerCase();
      return passwords.get(e) === password ? { id: e, email: e } : null;
    },
    async createUser(email, password) {
      const e = email.toLowerCase();
      if (passwords.has(e)) return 'exists';
      passwords.set(e, password);
      return 'created';
    },
    async setPassword(userId, password) { passwords.set(userId, password); }
  };
}
