/* Spins: every turn of the dial, claimed or not. Most people turn and leave without giving a phone number; this is
 * where they show up: what the dial landed on, whether they claimed it, how they got to the site, and how many times
 * that device has turned. A claimed spin opens its code. */
import { S } from './store.js';
import { idsLine, visitLine } from '../lib/profile.js';
import { openCode, STATUS } from './codes.js';
import { BASE, api, esc, $, dialog, fmtWhen, fmtShortWhen, fmtPhone, fmtNum, fmtPct } from './ui.js';

const OUTCOME = { claimed: 'Claimed', unclaimed: 'Didn\'t claim', holding: 'Holding now' };
const OUTCOME_TAG = { claimed: 'won', unclaimed: 'missed', holding: 'held' };
const CLICK = { gclid: 'Google ad', gbraid: 'Google ad', wbraid: 'Google ad', fbclid: 'Meta ad', msclkid: 'Bing ad', ttclid: 'TikTok ad', _kx: 'Klaviyo' };
const f = { outcome: '', gift: '', device: '', page: 1 };
let root = null, seq = 0, rows = [];

const tag = (o) => `<span class="tag ${OUTCOME_TAG[o]}">${esc(OUTCOME[o] || o)}</span>`;
const query = (extra = {}) => new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v !== '' && v != null)).toString();
const promo = (s) => `<span style="display:inline-flex;gap:8px;align-items:center"><i class="swatch" style="background:${esc(s.giftFill)}"></i>${esc(s.giftName)}</span>`;
const timeOnSite = (sec) => (sec == null ? '' : sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`);

/** 'Meta ad', 'google/cpc', 'facebook.com' or 'direct': the one-word answer to how they got here this visit. */
function cameFrom(c) {
  if (!c) return '';
  const a = c.ads || {};
  const click = Object.keys(CLICK).find((k) => a[k]);
  if (click) return CLICK[click];
  if (a.utm_source) return [a.utm_source, a.utm_medium].filter(Boolean).join('/');
  if (c.referrer) return c.referrer.split('/')[0];
  return 'direct';
}

export function render(main) {
  root = main;
  const gifts = S.live.config.gifts;
  main.innerHTML = `
    <div class="head"><div>
      <p class="eyebrow">Everyone who turned</p><h1>Spins</h1>
      <p class="muted">Every turn of the dial, claimed or not. Open one for the visit behind it; a claimed spin opens its code.</p>
      <p class="small muted" id="ssum"></p>
    </div></div>
    <div class="filters spins">
      <label class="f"><span>Outcome</span><select id="so"><option value="">Any outcome</option>${Object.entries(OUTCOME).map(([k, v]) => `<option value="${k}" ${f.outcome === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f"><span>Landed on</span><select id="sg"><option value="">Any promo</option>${gifts.map((g) => `<option value="${esc(g.id)}" ${f.gift === g.id ? 'selected' : ''}>${esc(g.name)}${g.active === false ? ' (off)' : ''}</option>`).join('')}</select></label>
      <div id="sdev"></div>
      <a class="btn quiet" id="scsv" href="#" download>Export CSV</a>
    </div>
    <div id="slist"><p class="muted">Loading…</p></div>`;
  $('#so', main).addEventListener('change', (e) => { f.outcome = e.target.value; f.page = 1; load(); });
  $('#sg', main).addEventListener('change', (e) => { f.gift = e.target.value; f.page = 1; load(); });
  $('#sdev', main).addEventListener('click', (e) => { if (e.target.closest('[data-alldev]')) { f.device = ''; f.page = 1; load(); } });
  $('#slist', main).addEventListener('click', (e) => {
    const d = e.target.closest('[data-device]'); if (d) { e.stopPropagation(); byDevice(d.dataset.device); return; }
    const r = e.target.closest('[data-spin]'); if (r) openSpin(r.dataset.spin);
    const p = e.target.closest('[data-page]'); if (p) { f.page = Number(p.dataset.page); load(); }
  });
  $('#slist', main).addEventListener('keydown', (e) => { const r = e.target.closest('[data-spin]'); if (r && e.target === r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSpin(r.dataset.spin); } });
  load();
}
export function destroy() { root = null; }

function byDevice(device) { f.device = device; f.page = 1; load(); }

async function load() {
  if (!root) return;
  const mine = ++seq;
  $('#scsv', root).href = `${BASE}api/admin/spins?${query({ format: 'csv', page: '' })}`;
  $('#sdev', root).innerHTML = f.device ? `<span class="chip">One device's spins <button type="button" class="linkbtn" data-alldev>Show everyone</button></span>` : '';
  const r = await api(`spins?${query()}`);
  if (mine !== seq || !root) return;
  const box = $('#slist', root);
  if (!r.ok) { box.innerHTML = `<p class="err">${esc(r.error)}</p>`; return; }
  $('#ssum', root).textContent = r.all ? `${fmtNum(r.all)} spin${r.all === 1 ? '' : 's'} so far · ${fmtNum(r.claimed)} claimed (${fmtPct((r.claimed / r.all) * 100, 0)}) · ${fmtNum(r.all - r.claimed)} not claimed` : '';
  rows = r.rows;
  if (!rows.length) { box.innerHTML = `<div class="tablewrap"><div class="empty">${f.outcome || f.gift || f.device ? 'No spins match.' : 'No spins yet. They show up here as soon as someone turns the dial.'}</div></div>`; return; }
  const from = (r.page - 1) * r.pageSize + 1, to = from + rows.length - 1, last = Math.ceil(r.total / r.pageSize);
  box.innerHTML = `
    <div class="tablewrap"><table>
      <thead><tr><th>Spun</th><th>Landed on</th><th>Outcome</th><th>Came from</th><th>Device</th><th class="num">Pages</th><th class="num">Spins</th></tr></thead>
      <tbody>${rows.map((s) => {
        const c = s.context || {};
        return `
        <tr class="click" data-spin="${esc(s.id)}" tabindex="0">
          <td style="white-space:nowrap">${esc(fmtShortWhen(s.created_at))}</td>
          <td>${promo(s)}</td>
          <td style="white-space:nowrap">${tag(s.outcome)}${s.code ? ` <b class="small">${esc(s.code)}</b>` : ''}</td>
          <td>${esc(cameFrom(s.context) || '–')}</td>
          <td>${esc(c.device || '–')}</td>
          <td class="num" style="white-space:nowrap">${c.pageViews != null ? `${fmtNum(c.pageViews)}${c.secondsOnSite != null ? ` · ${esc(timeOnSite(c.secondsOnSite))}` : ''}` : '–'}</td>
          <td class="num">${s.deviceTurns > 1 && s.device && !f.device ? `<button type="button" class="linkbtn" data-device="${esc(s.device)}" title="Show this device's spins">${fmtNum(s.deviceTurns)}</button>` : fmtNum(s.deviceTurns)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div class="pager"><span class="muted small">${fmtNum(from)}–${fmtNum(to)} of ${fmtNum(r.total)}</span>
      <button class="btn quiet sm" data-page="${r.page - 1}" ${r.page <= 1 ? 'disabled' : ''}>← Newer</button>
      <button class="btn quiet sm" data-page="${r.page + 1}" ${r.page >= last ? 'disabled' : ''}>Older →</button></div>`;
}

/* ---------------- one spin ---------------- */

function outcomeLine(s) {
  if (s.outcome === 'claimed') {
    return `${tag('claimed')} <button type="button" class="linkbtn" data-open="${esc(s.code)}">${esc(s.code)}</button>${s.codeStatus ? ` <span class="muted small">(${esc(STATUS[s.codeStatus] || s.codeStatus)})</span>` : ''}`;
  }
  if (s.outcome === 'holding') return `${tag('holding')} <span class="muted small">until ${esc(fmtWhen(s.held_until))}</span>`;
  return `${tag('unclaimed')} <span class="muted small">the hold ran out ${esc(fmtWhen(s.held_until))} without a phone number</span>`;
}

function facts(s) {
  const c = s.context || {}, g = c.geo || {};
  const ids = idsLine(c);
  const device = [c.device, c.screen, c.lang, c.tz].filter(Boolean).join(' · ');
  const rows = [
    ['Spun', esc(fmtWhen(s.created_at))],
    ['Landed on', `${promo(s)} · $${esc(s.giftValue)}`],
    ['Outcome', outcomeLine(s)],
    s.phone ? ['Phone', `<a href="tel:${esc(s.phone)}">${esc(fmtPhone(s.phone))}</a>${s.first_name ? ` · ${esc(s.first_name)}` : ''}`] : null,
    ['Visit', s.context ? esc(visitLine(s.context) || '–') : '<span class="muted">Not recorded</span>'],
    c.page ? ['Spun on', esc(c.page)] : null,
    c.pages && c.pages.length ? ['Pages', `<span class="small">${c.pages.map(esc).join(' → ')}</span>`] : null,
    c.secondsOnSite != null ? ['Time on site', esc(timeOnSite(c.secondsOnSite))] : null,
    ['Device', esc(device || '–')],
    ['Spins from it', s.deviceTurns > 1 && s.device ? `${fmtNum(s.deviceTurns)} · <button type="button" class="linkbtn" data-device="${esc(s.device)}">Show them</button>` : fmtNum(s.deviceTurns)],
    g.city || g.zip ? ['Near', esc([g.city, g.zip].filter(Boolean).join(' ') + (g.inArea === true ? ' (in area)' : g.inArea === false ? ' (outside our ZIPs)' : ''))] : null,
    ids ? ['Ad ids', `<span class="small">${esc(ids)}</span>`] : null,
    s.ip ? ['IP', `<span class="small">${esc(s.ip)}</span>`] : null
  ].filter(Boolean);
  return `<dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

async function openSpin(id) {
  const s = rows.find((x) => x.id === id);
  if (!s) return;
  let next = null;
  await dialog({
    title: s.giftName, eyebrow: 'Spin', wide: true, body: facts(s), actions: [{ label: 'Close', value: null }],
    onOpen: (d) => d.addEventListener('click', (e) => {
      const o = e.target.closest('[data-open]'), dv = e.target.closest('[data-device]');
      if (o) next = () => openCode(o.dataset.open);
      else if (dv) next = () => byDevice(dv.dataset.device);
      else return;
      $('footer button', d).click();
    })
  });
  if (next) next();
}
