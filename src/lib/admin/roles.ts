/* Who may do what in the admin. An admin does everything. A CSR gets the Codes tab: find a code, mark it redeemed,
 * text it again. The role comes from comfort_dial_admins on every request (src/middleware.ts), so a change takes
 * effect at once; codeAction checks the code actions again. */
export type Role = 'admin' | 'csr';
export const ROLE_NAMES: Record<Role, string> = { admin: 'Admin', csr: 'CSR' };

/** A stored role, read safely: anything but 'csr' (including no column yet) is an admin. */
export const roleOf = (r: unknown): Role => (r === 'csr' ? 'csr' : 'admin');

/** The admin API calls a CSR may make, as "METHOD path" with the path after api/admin/. The config is read-only
 *  here (the Codes tab names the promos from it); the CSV export is admin-only (see api/admin/codes.ts). */
const CSR_CALLS = new Set(['GET config', 'GET codes', 'GET code', 'POST code', 'POST logout', 'POST password']);
export const mayCall = (role: Role, method: string, path: string) => role === 'admin' || CSR_CALLS.has(`${method.toUpperCase()} ${path.replace(/\/+$/, '')}`);

export const CSR_CODE_ACTIONS: readonly string[] = ['redeem', 'resend'];
