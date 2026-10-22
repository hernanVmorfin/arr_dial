/* Team: who can sign in to the admin, and as what. Passwords live in Supabase Auth; this list decides who gets in.
 * An admin does everything; a CSR gets the Codes tab only (lib/admin/roles.ts). Adding someone creates their account
 * with a temporary password to pass on (they change it under their name, top right). If they already have an
 * account in this Supabase project, they keep their own password. */
import { BOOT, api, esc, $, confirmDialog, toast, fmtDate, ago } from './ui.js';

const ROLES = { admin: 'Admin', csr: 'CSR' };

let root = null;
export function render(main) {
  root = main;
  main.innerHTML = `
    <div class="head"><div>
      <p class="eyebrow">Who can get in</p><h1>Team</h1>
      <p class="muted"><b>Admins</b> change promos and odds, publish, pause the dial and work codes. <b>CSRs</b> get the Codes tab only: find a code, mark it redeemed, text it again. A change of role or a removal takes effect at once.</p>
    </div></div>
    <div class="grid2">
      <section class="card"><h2>People</h2><div id="tlist"><p class="muted">Loading…</p></div></section>
      <section class="card"><h2>Add someone</h2>
        <form id="tadd" class="row" novalidate>
          <label class="f"><span>Name</span><input type="text" name="name" maxlength="60" autocomplete="off" required></label>
          <label class="f"><span>Email</span><input type="email" name="email" autocomplete="off" required></label>
          <label class="f"><span>Role</span><select name="role"><option value="csr">CSR: Codes only</option><option value="admin">Admin: everything</option></select></label>
          <label class="f"><span>Temporary password</span>
            <div class="unit"><input type="text" name="password" minlength="12" autocomplete="new-password" spellcheck="false" required><button type="button" class="btn quiet sm" id="gen" style="border-radius:0 8px 8px 0;border-left:0">Make one</button></div>
            <small>At least 12 characters. Give it to them in person or by phone, not by email.</small></label>
          <p class="err" id="terr" role="alert"></p>
          <div><button class="btn" type="submit">Add to the team</button></div>
        </form>
      </section>
    </div>`;
  $('#gen', main).addEventListener('click', () => { $('[name="password"]', main).value = makePassword(); });
  $('#tadd', main).addEventListener('submit', add);
  $('#tlist', main).addEventListener('click', remove);
  $('#tlist', main).addEventListener('change', changeRole);
  load();
}
export function destroy() { root = null; }

/* Four words' worth of randomness, easy to read out: xxxx-xxxx-xxxx-xxxx without look-alike characters. */
function makePassword() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789', b = new Uint32Array(16);
  crypto.getRandomValues(b);
  return [...b].map((n, i) => (i && i % 4 === 0 ? '-' : '') + A[n % A.length]).join('');
}

async function load() {
  const r = await api('team');
  if (!root) return;
  const box = $('#tlist', root);
  if (!r.ok) { box.innerHTML = `<p class="err">${esc(r.error)}</p>`; return; }
  box.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Last sign-in</th><th></th></tr></thead><tbody>
    ${r.admins.map((a) => `<tr><td><b>${esc(a.name)}</b><br><span class="small muted">Added ${esc(fmtDate(a.created_at))}${a.created_by ? ` by ${esc(a.created_by)}` : ''}</span></td>
      <td>${a.email === BOOT.me.email ? esc(ROLES[a.role]) : `<select data-role="${esc(a.email)}" aria-label="Role for ${esc(a.name)}">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${a.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`}</td>
      <td>${esc(a.email)}</td><td>${a.lastLogin ? esc(ago(a.lastLogin)) : '<span class="muted">Never</span>'}</td>
      <td>${a.email === BOOT.me.email ? '<span class="tag">You</span>' : `<button type="button" class="btn quiet sm" data-rm="${esc(a.email)}">Remove</button>`}</td></tr>`).join('')}
  </tbody></table></div>`;
}

async function add(e) {
  e.preventDefault();
  const f = e.currentTarget, err = $('#terr', root), data = Object.fromEntries(new FormData(f));
  if (!data.name || !data.email) { err.textContent = 'Enter their name and email.'; return; }
  if (String(data.password).length < 12) { err.textContent = 'The temporary password needs at least 12 characters. Press Make one.'; return; }
  const b = $('button[type="submit"]', f); b.disabled = true; err.textContent = '';
  const r = await api('team', { method: 'POST', body: data });
  b.disabled = false;
  if (!r.ok) { err.textContent = r.error || 'Couldn\'t add them.'; return; }
  f.reset();
  toast(`${data.name} added as ${data.role === 'csr' ? 'a CSR' : 'an admin'}. ${r.existingAccount ? 'They already had an account here, so they sign in with their own password.' : 'Pass on the temporary password; they can change it after signing in.'}`);
  load();
}

async function changeRole(e) {
  const sel = e.target.closest('[data-role]');
  if (!sel) return;
  const email = sel.dataset.role, role = sel.value;
  sel.disabled = true;
  const r = await api('team', { method: 'PATCH', body: { email, role } });
  sel.disabled = false;
  if (!r.ok) { toast(r.error || 'Couldn\'t change their role.', true); load(); return; }
  toast(role === 'csr' ? `${email} is a CSR now: Codes only.` : `${email} is an admin now.`);
}

async function remove(e) {
  const b = e.target.closest('[data-rm]');
  if (!b) return;
  const email = b.dataset.rm;
  if (!(await confirmDialog('Remove them from the team?', `${esc(email)} can't get into the dial admin from now on. Their history stays.`, 'Remove'))) return;
  const r = await api('team', { method: 'DELETE', body: { email } });
  if (!r.ok) { toast(r.error || 'Couldn\'t remove them.', true); return; }
  toast(`${email} removed.`);
  load();
}
