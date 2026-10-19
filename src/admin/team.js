/* Team: who can sign in to the admin. Passwords live in Supabase Auth; this list decides who is an admin.
 * Adding someone creates their account with a temporary password to pass on (they change it under their name, top
 * right). If they already have an account in this Supabase project, they keep their own password. */
import { BOOT, api, esc, $, confirmDialog, toast, fmtDate, ago } from './ui.js';

let root = null;
export function render(main) {
  root = main;
  main.innerHTML = `
    <div class="head"><div>
      <p class="eyebrow">Who can get in</p><h1>Team</h1>
      <p class="muted">Everyone here can change promos and odds, publish, pause the dial and work codes. Removing someone locks them out at once.</p>
    </div></div>
    <div class="grid2">
      <section class="card"><h2>Admins</h2><div id="tlist"><p class="muted">Loading…</p></div></section>
      <section class="card"><h2>Add an admin</h2>
        <form id="tadd" class="row" novalidate>
          <label class="f"><span>Name</span><input type="text" name="name" maxlength="60" autocomplete="off" required></label>
          <label class="f"><span>Email</span><input type="email" name="email" autocomplete="off" required></label>
          <label class="f"><span>Temporary password</span>
            <div class="unit"><input type="text" name="password" minlength="12" autocomplete="new-password" spellcheck="false" required><button type="button" class="btn quiet sm" id="gen" style="border-radius:0 8px 8px 0;border-left:0">Make one</button></div>
            <small>At least 12 characters. Give it to them in person or by phone, not by email.</small></label>
          <p class="err" id="terr" role="alert"></p>
          <div><button class="btn" type="submit">Add admin</button></div>
        </form>
      </section>
    </div>`;
  $('#gen', main).addEventListener('click', () => { $('[name="password"]', main).value = makePassword(); });
  $('#tadd', main).addEventListener('submit', add);
  $('#tlist', main).addEventListener('click', remove);
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
  box.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Last sign-in</th><th></th></tr></thead><tbody>
    ${r.admins.map((a) => `<tr><td><b>${esc(a.name)}</b><br><span class="small muted">Added ${esc(fmtDate(a.created_at))}${a.created_by ? ` by ${esc(a.created_by)}` : ''}</span></td>
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
  toast(r.existingAccount ? `${data.name} added. They already had an account here, so they sign in with their own password.` : `${data.name} added. Pass on the temporary password; they can change it after signing in.`);
  load();
}

async function remove(e) {
  const b = e.target.closest('[data-rm]');
  if (!b) return;
  const email = b.dataset.rm;
  if (!(await confirmDialog('Remove this admin?', `${esc(email)} can't get into the dial admin from now on. Their history stays.`, 'Remove'))) return;
  const r = await api('team', { method: 'DELETE', body: { email } });
  if (!r.ok) { toast(r.error || 'Couldn\'t remove them.', true); return; }
  toast(`${email} removed.`);
  load();
}
