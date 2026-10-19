/* Small helpers every admin tab uses: the API call, escaping, formatting, toasts and dialogs. */
export const BOOT = JSON.parse(document.getElementById('boot').textContent);
export const BASE = BOOT.base;

/** JSON call to /api/admin/*. A 401 means the session ended: back to the sign-in page. Never throws: a network
 *  failure comes back as { ok:false, status:0, error }. */
export async function api(path, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch(`${BASE}api/admin/${path}`, {
      method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin'
    });
  } catch {
    return { ok: false, status: 0, error: 'We couldn\'t reach the server. Check your connection and try again.' };
  }
  if (r.status === 401) { location.href = `${BASE}admin/login?next=${encodeURIComponent(location.pathname + location.hash)}`; return { ok: false, status: 401, error: 'Sign in again.' }; }
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j, ok: r.ok && j.ok !== false };
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const TZ = 'America/Chicago';
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' }) : '');
export const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const fmtShortWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const fmtPhone = (d) => (d && d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d || '');
export const fmtNum = (n) => (n ?? 0).toLocaleString('en-US');
export const fmtMoney = (n) => `$${Math.round(n ?? 0).toLocaleString('en-US')}`;
export const fmtPct = (n, digits = 1) => (n == null || !isFinite(n) ? '–' : `${Number(n.toFixed(digits))}%`);
export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDate(iso);
}

export function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = `toast${bad ? ' bad' : ''}`; t.setAttribute('role', bad ? 'alert' : 'status'); t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), bad ? 7000 : 3500);
}

/** A modal dialog. `body` is HTML; `actions` are buttons, the last one primary. Each action's run(dlg) may return
 *  false to keep the dialog open (a validation error, a failed call). Resolves with the chosen action's value. */
export function dialog({ title, eyebrow = '', body, actions = [{ label: 'Close', value: null }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    if (wide) d.classList.add('drawer');
    d.innerHTML = `<div class="dlg"><header>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h2>${esc(title)}</h2></header>
      <div class="body">${body}</div>
      <footer>${actions.map((a, i) => `<button type="button" class="btn ${a.kind || (i === actions.length - 1 ? '' : 'quiet')}" data-i="${i}">${esc(a.label)}</button>`).join('')}</footer></div>`;
    document.body.appendChild(d);
    let done = false;
    const finish = (v) => { if (done) return; done = true; d.close(); d.remove(); resolve(v); };
    d.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    d.addEventListener('click', (e) => { if (e.target === d) finish(null); });
    $$('footer button', d).forEach((b) => b.addEventListener('click', async () => {
      const a = actions[Number(b.dataset.i)];
      if (a.run) {
        $$('footer button', d).forEach((x) => { x.disabled = true; });
        const keep = (await a.run(d)) === false;
        $$('footer button', d).forEach((x) => { x.disabled = false; });
        if (keep) return;
      }
      finish(a.value === undefined ? a.label : a.value);
    }));
    d.showModal();
    if (onOpen) onOpen(d);
  });
}

export const confirmDialog = (title, body, label, kind = 'red') =>
  dialog({ title, body: `<p style="margin:0">${body}</p>`, actions: [{ label: 'Cancel', value: false }, { label, value: true, kind }] });
