/* Codes: find a winner by code, phone, name or street; open one to redeem, void, restore, extend or text it again.
 * Every action lands on the code's history with who did it. Monday and Klaviyo follow on their own. */
import { S } from './store.js';
import { homeLine, homeHints, priorLine, priorChecked, visitLine } from '../lib/profile.js';
import { BASE, api, esc, $, dialog, toast, fmtDate, fmtWhen, fmtShortWhen, fmtPhone, fmtNum } from './ui.js';

export const STATUS = { issued: 'Usable', redeemed: 'Redeemed', expired: 'Expired', void: 'Void' };
const ACTION_WORDS = { redeem: 'Marked redeemed', void: 'Voided', restore: 'Restored', extend: 'Extended', resend: 'Texted the code again' };
const f = { q: '', status: '', gift: '', page: 1 };
let root = null, timer = null, seq = 0;

const tag = (st) => `<span class="tag ${esc(st)}">${esc(STATUS[st] || st)}</span>`;
const query = (extra = {}) => new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v !== '' && v != null)).toString();

export function render(main) {
  root = main;
  const gifts = S.live.config.gifts;
  main.innerHTML = `
    <div class="head"><div>
      <p class="eyebrow">Find a winner</p><h1>Codes</h1>
      <p class="muted">Search by code, phone number, first name or street. Open a code to redeem, void, extend or text it again.</p>
    </div></div>
    <div class="filters">
      <label class="f q"><span>Search</span><input type="search" id="cq" placeholder="ARR-7K3P, 708 555, Maria, Ravinia" value="${esc(f.q)}" autocomplete="off"></label>
      <label class="f"><span>Status</span><select id="cs"><option value="">Any status</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f"><span>Promo</span><select id="cg"><option value="">Any promo</option>${gifts.map((g) => `<option value="${esc(g.id)}" ${f.gift === g.id ? 'selected' : ''}>${esc(g.name)}${g.active === false ? ' (off)' : ''}</option>`).join('')}</select></label>
      <a class="btn quiet" id="csv" href="#" download>Export CSV</a>
    </div>
    <div id="clist"><p class="muted">Loading…</p></div>`;
  $('#cq', main).addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { f.q = e.target.value.trim(); f.page = 1; load(); }, 280); });
  $('#cs', main).addEventListener('change', (e) => { f.status = e.target.value; f.page = 1; load(); });
  $('#cg', main).addEventListener('change', (e) => { f.gift = e.target.value; f.page = 1; load(); });
  $('#clist', main).addEventListener('click', (e) => {
    const r = e.target.closest('[data-code]'); if (r) openCode(r.dataset.code);
    const p = e.target.closest('[data-page]'); if (p) { f.page = Number(p.dataset.page); load(); }
  });
  $('#clist', main).addEventListener('keydown', (e) => { const r = e.target.closest('[data-code]'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCode(r.dataset.code); } });
  load();
}
export function destroy() { root = null; }

async function load() {
  if (!root) return;
  const mine = ++seq;
  $('#csv', root).href = `${BASE}api/admin/codes?${query({ format: 'csv', page: '' })}`;
  const r = await api(`codes?${query()}`);
  if (mine !== seq || !root) return;
  const box = $('#clist', root);
  if (!r.ok) { box.innerHTML = `<p class="err">${esc(r.error)}</p>`; return; }
  if (!r.rows.length) { box.innerHTML = `<div class="tablewrap"><div class="empty">${f.q || f.status || f.gift ? 'No codes match.' : 'No codes yet. They show up here as people win.'}</div></div>`; return; }
  const from = (r.page - 1) * r.pageSize + 1, to = from + r.rows.length - 1, last = Math.ceil(r.total / r.pageSize);
  box.innerHTML = `
    <div class="tablewrap"><table>
      <thead><tr><th>Code</th><th>Promo</th><th>Phone</th><th>Name</th><th>Won</th><th>Expires</th><th>Status</th></tr></thead>
      <tbody>${r.rows.map((e) => `
        <tr class="click" data-code="${esc(e.code)}" tabindex="0">
          <td><b>${esc(e.code)}</b></td>
          <td><span style="display:inline-flex;gap:8px;align-items:center"><i class="swatch" style="background:${esc(e.giftFill)}"></i>${esc(e.giftName)}</span></td>
          <td class="num" style="white-space:nowrap">${esc(fmtPhone(e.phone))}</td>
          <td>${esc(e.first_name || '')}</td>
          <td style="white-space:nowrap">${esc(fmtShortWhen(e.created_at))}</td>
          <td style="white-space:nowrap">${esc(fmtDate(e.expires_at))}</td>
          <td>${tag(e.status)}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div class="pager"><span class="muted small">${fmtNum(from)}–${fmtNum(to)} of ${fmtNum(r.total)}</span>
      <button class="btn quiet sm" data-page="${r.page - 1}" ${r.page <= 1 ? 'disabled' : ''}>← Newer</button>
      <button class="btn quiet sm" data-page="${r.page + 1}" ${r.page >= last ? 'disabled' : ''}>Older →</button></div>`;
}

/* ---------------- one code ---------------- */

function facts(e) {
  const utm = e.utm ? Object.entries(e.utm).map(([k, v]) => `${k.replace(/^utm_/, '')}: ${v}`).join(' · ') : '';
  const rows = [
    ['Promo', `<span style="display:inline-flex;gap:8px;align-items:center"><i class="swatch" style="background:${esc(e.giftFill)}"></i>${esc(e.giftName)} · $${esc(e.giftValue)}</span>`],
    ['Status', tag(e.status)],
    ['Phone', `<a href="tel:${esc(e.phone)}">${esc(fmtPhone(e.phone))}</a>`],
    ['Name', esc(e.first_name || '–')],
    ['Address', e.address ? `${esc(e.address)}, ${esc(e.zip)}` : '<span class="muted">Not given</span>'],
    ['Won', esc(fmtWhen(e.created_at))],
    ['Expires', esc(fmtDate(e.expires_at))],
    e.redeemed_at ? ['Redeemed', `${esc(fmtWhen(e.redeemed_at))}<br><span class="muted small">${esc(e.redeemed_note || '')}</span>`] : null,
    e.voided_at ? ['Voided', `${esc(fmtWhen(e.voided_at))}<br><span class="muted small">${esc(e.voided_note || '')}</span>`] : null,
    ['Reminder texts', e.sms_marketing ? 'Opted in' : 'No'],
    utm ? ['Came from', esc(utm)] : null,
    e.page ? ['Page', `<span class="small">${esc(e.page)}</span>`] : null,
    ['Monday item', e.monday_item_id ? esc(e.monday_item_id) : '<span class="muted">None yet</span>']
  ].filter(Boolean);
  return `<dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${known(e)}`;
}

/* Earlier contact, and which sources were actually asked: Monday or Klaviyo not set up (or failing) isn't "nothing". */
function seenBefore(p) {
  if (!p) return '<span class="muted">Not checked yet</span>';
  const checked = priorChecked(p), skipped = ['Monday', 'Klaviyo'].filter((s) => !checked.includes(s));
  const found = priorLine(p) || (checked.length ? `Nothing found (checked ${checked.join(', ')})` : 'Nothing checked');
  const note = skipped.length ? `Not checked: ${skipped.join(' and ')}${p.errors ? ' (a lookup failed; see the logs)' : ' (not set up)'}` : p.errors ? 'Some lookups failed; see the logs.' : '';
  return esc(found) + (note ? `<br><span class="muted small">${esc(note)}</span>` : '');
}

/* What we learned beyond the form: the county record, earlier contact, the visit. Internal only. */
function known(e) {
  const hints = homeHints(e.home);
  const ids = e.context && e.context.ids ? Object.entries(e.context.ids).map(([k, v]) => `${{ ga: 'GA', fbp: 'Meta browser', fbc: 'Meta click', kx: 'Klaviyo' }[k] || k}: ${v}`).join(' · ') : '';
  const rows = [
    ['Home', e.home ? esc(homeLine(e.home)) : `<span class="muted">${e.address ? 'Not in county records' : 'No address yet'}</span>`],
    hints.length ? ['Worth asking', esc(hints.join('; '))] : null,
    ['Seen before', seenBefore(e.prior)],
    ['Visit', e.context ? esc(visitLine(e.context) || '–') : '<span class="muted">Not recorded</span>'],
    ids ? ['Ad ids', `<span class="small">${esc(ids)}</span>`] : null
  ].filter(Boolean);
  return `<p class="label" style="margin:10px 0 4px">What we know beyond the form</p><dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function actions(e) {
  const b = (act, label, kind = 'quiet') => `<button type="button" class="btn ${kind} sm" data-do="${act}">${label}</button>`;
  if (e.status === 'void') return b('restore', 'Restore code');
  if (e.status === 'redeemed') return '<span class="muted small">Used. Nothing left to do.</span>';
  return [b('redeem', 'Mark redeemed', ''), b('extend', 'Extend'), e.status === 'issued' ? b('resend', 'Text it again') : '', b('void', 'Void', 'quiet')].join('');
}

function history(rows) {
  if (!rows.length) return '<p class="muted small" style="margin:0">Nothing done to this code in the admin yet.</p>';
  return `<ul class="log">${rows.map((h) => {
    const d = h.detail || {};
    const extra = h.action === 'extend' && d.to ? ` to ${fmtDate(d.to)}` : '';
    return `<li><b>${esc(ACTION_WORDS[h.action] || h.action)}${esc(extra)}</b>${d.note ? ` · ${esc(d.note)}` : ''}<br><span class="muted small">${esc(fmtWhen(h.at))} · ${esc(h.actor)}</span></li>`;
  }).join('')}</ul>`;
}

const FORMS = {
  redeem: () => ({ title: 'Mark redeemed', body: `<label class="f"><span>Note (optional)</span><input type="text" name="note" maxlength="200" placeholder="Job number, tech, anything useful"></label><p class="small muted" style="margin:0">Monday's Code status changes to Redeemed and the reminder texts stop.</p>`, label: 'Mark redeemed', kind: '' }),
  void: (e) => ({ title: 'Void this code', body: `<label class="f"><span>Reason</span><input type="text" name="note" maxlength="200" required placeholder="Second gift for the same home"></label><p class="small muted" style="margin:0">${esc(e.code)} stops working. Monday shows it as Void and the reminder texts stop. You can restore it later.</p>`, label: 'Void code', kind: 'red' }),
  restore: (e) => ({ title: 'Restore this code', body: `<p style="margin:0">${esc(e.code)} works again until ${esc(fmtDate(e.expires_at))}. Reminder texts that were stopped stay stopped.</p>`, label: 'Restore', kind: '' }),
  extend: (e) => ({ title: 'Extend the expiry', body: `<label class="f"><span>Add</span><select name="days"><option value="7">7 days</option><option value="14" selected>14 days</option><option value="30">30 days</option><option value="60">60 days</option></select></label><p class="small muted" style="margin:0">From ${e.status === 'expired' ? 'today, since it has run out' : `the current expiry, ${esc(fmtDate(e.expires_at))}`}. Monday's notes update. Reminder texts already scheduled still show the old date.</p>`, label: 'Extend', kind: '' }),
  resend: (e) => ({ title: 'Text the code again', body: `<p style="margin:0">Podium texts ${esc(e.code)} to ${esc(fmtPhone(e.phone))} from ARR's number, with the gift and expiry date. Up to 3 times a day.</p>`, label: 'Send the text', kind: '' })
};

async function openCode(code) {
  let r = await api(`code?code=${encodeURIComponent(code)}`);
  if (!r.ok) { toast(r.error || 'Couldn\'t open that code.', true); return; }
  const paint = (d) => {
    $('.body', d).innerHTML = `<div class="codebig">${esc(r.entry.code)}</div>${facts(r.entry)}
      <div class="acts" id="acts">${actions(r.entry)}</div>
      <div><p class="label" style="margin:6px 0">History</p>${history(r.history)}</div>`;
  };
  await dialog({
    title: r.entry.giftName, eyebrow: 'Code', wide: true, body: '', actions: [{ label: 'Close', value: null }],
    onOpen: (d) => {
      paint(d);
      d.addEventListener('click', async (ev) => {
        const b = ev.target.closest('[data-do]');
        if (!b) return;
        const act = b.dataset.do, form = FORMS[act](r.entry);
        const res = await dialog({
          title: form.title, body: `<form novalidate>${form.body}<p class="err" style="margin-top:10px"></p></form>`,
          actions: [{ label: 'Cancel', value: null }, {
            label: form.label, kind: form.kind,
            run: async (dd) => {
              const fd = Object.fromEntries(new FormData($('form', dd)));
              if (act === 'void' && !String(fd.note || '').trim()) { $('.err', dd).textContent = 'Say why it\'s being voided.'; return false; }
              const out = await api('code', { method: 'POST', body: { code: r.entry.code, action: act, note: fd.note, days: fd.days ? Number(fd.days) : undefined } });
              if (!out.ok) { $('.err', dd).textContent = out.error || 'That didn\'t go through.'; return false; }
              r = out; return true;
            }
          }]
        });
        if (res !== null) { toast(`${ACTION_WORDS[act]}: ${r.entry.code}`); paint(d); load(); }
      });
    }
  });
}
