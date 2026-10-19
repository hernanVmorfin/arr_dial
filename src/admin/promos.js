/* Promos & odds: each gift's words, value, colours and odds, with the dial drawn live beside them exactly as the
 * popup draws it (src/widget/face.js). The list is drawn once and patched as you type, so inputs keep focus; the
 * preview, totals, odds table, dial order and checks redraw on every change. */
import { validateConfig, oddsInPlay, activeGifts } from '../lib/rules.js';
import { svgInner, drawFace, fToAng, hubSize, VIEWBOX } from '../widget/face.js';
import { S, edit, on } from './store.js';
import { esc, $, $$, fmtPct } from './ui.js';

const open = new Set();
let root = null, off = null;
const pctOf = (n) => `${Number((+n || 0).toFixed(2))}%`;
const isNew = (g) => !S.live.config.gifts.some((x) => x.id === g.id);
const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); };

function slug(name, gifts, self) {
  const base = String(name).toLowerCase().replace(/\$/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'promo';
  let id = base.length < 2 ? `${base}_x` : base, n = 2;
  while (gifts.some((g) => g !== self && g.id === id)) id = `${base.slice(0, 20)}_${n++}`;
  return id;
}

export function render(main) {
  root = main;
  main.innerHTML = `
    <div class="head">
      <div>
        <p class="eyebrow">What the dial gives away</p>
        <h1>Promos &amp; odds</h1>
        <p class="muted">A promo's odds are also the size of its slice on the dial. The promos that are on must add up to 100%. Nothing on the site changes until you publish.</p>
      </div>
      <button class="btn ghost" type="button" data-act="add">+ Add a promo</button>
    </div>
    <div class="editor">
      <div id="gifts"></div>
      <aside class="side">
        <div class="dialbox">
          <div class="label">Preview · what visitors see</div>
          <svg id="pv" viewBox="${VIEWBOX}" role="img" aria-label="Preview of the dial">${svgInner('adm')}</svg>
          <div id="total"></div>
          <div class="odds" id="odds"></div>
          <div class="order"><div class="label">Dial order, cool → heat</div><ol id="order"></ol></div>
        </div>
        <div class="checks" id="checks"></div>
      </aside>
    </div>`;
  $('#pv [data-arrd="marker"]').setAttribute('transform', `rotate(${fToAng(68)})`);
  drawList();
  drawSide();
  main.querySelector('[data-act="add"]').addEventListener('click', addGift);
  const list = $('#gifts');
  list.addEventListener('input', onInput);
  list.addEventListener('change', onChange);
  list.addEventListener('click', onClick);
  list.addEventListener('focusin', (e) => { const c = e.target.closest('.gift'); if (c) pointAt(Number(c.dataset.i)); });
  list.addEventListener('mouseover', (e) => { const c = e.target.closest('.gift'); if (c) pointAt(Number(c.dataset.i)); });
  $('#order').addEventListener('click', onOrder);
  off = on(({ quiet }) => { if (!quiet) drawList(); drawSide(); });
}

export function destroy() { if (off) off(); off = null; root = null; }

/* ---------------- the list ---------------- */

function drawList() {
  const box = $('#gifts', root);
  if (!box) return;
  const M = S.draft.membership;
  box.innerHTML = S.draft.gifts.map((g, i) => {
    const onNow = g.active !== false, mem = g.id === M.giftId, fresh = isNew(g);
    return `
    <section class="gift${onNow ? '' : ' is-off'}" data-i="${i}" style="--gift:${esc(g.fill)}">
      <div class="gift-top">
        <div class="nm"><b data-k="title">${esc(g.name || 'New promo')}</b><small>${mem ? 'Free year · one a month' : fresh ? 'New · not published yet' : `$${esc(g.value)} value`}</small></div>
        <label class="switch" title="On the dial or not"><input type="checkbox" data-f="active" ${onNow ? 'checked' : ''}><i></i><span class="small">${onNow ? 'On' : 'Off'}</span></label>
        <div class="w"><div class="unit"><input type="number" inputmode="decimal" min="0" max="100" step="0.5" data-f="weight" value="${esc(g.weight)}" aria-label="Odds for ${esc(g.name)}" ${onNow ? '' : 'disabled'}><b>%</b></div></div>
        <button class="toggle" type="button" data-act="open" aria-expanded="${open.has(i)}" aria-label="Edit ${esc(g.name)}">▾</button>
      </div>
      <div class="gift-body" ${open.has(i) ? '' : 'hidden'}>
        <div class="row cols-2">
          <label class="f"><span>Name</span><input type="text" data-f="name" maxlength="60" value="${esc(g.name)}"><small>What the winner sees: "You won …"</small></label>
          <label class="f"><span>Short name</span><input type="text" data-f="short" maxlength="22" value="${esc(g.short)}"><small>In the dial's centre as the needle passes. 22 characters.</small></label>
        </div>
        <label class="f"><span>Description</span><input type="text" data-f="sub" maxlength="140" value="${esc(g.sub)}"><small>One line under the name, and in the CSR's notes on Monday.</small></label>
        <div class="row cols-3">
          <label class="f"><span>Value</span><div class="unit"><input type="number" min="0" max="10000" step="1" data-f="value" value="${esc(g.value)}"><b>$</b></div></label>
          <label class="f"><span>Dial label, big</span><input type="text" data-f="big" maxlength="12" value="${esc(g.big)}"><small>Like $50 OFF</small></label>
          <label class="f"><span>Dial label, small</span><input type="text" data-f="small" maxlength="18" value="${esc(g.small)}"><small>Like DUCT CLEANING</small></label>
        </div>
        <div class="colors">
          <label class="f"><span>Slice colour</span><span class="colorpick"><input type="color" data-f="fill" value="${esc(g.fill)}" aria-label="Slice colour"><input type="text" data-f="fill" maxlength="7" value="${esc(g.fill)}" aria-label="Slice colour hex"></span></label>
          <label class="f"><span>Label colour</span><span class="colorpick"><input type="color" data-f="ink" value="${esc(g.ink)}" aria-label="Label colour"><input type="text" data-f="ink" maxlength="7" value="${esc(g.ink)}" aria-label="Label colour hex"></span></label>
        </div>
        ${mem ? `<p class="callout blue small">The free year is in play one per month, in ${esc(M.months.map(monthName).join(', '))}. Once a month's is claimed it leaves the odds until the 1st, and the other promos' odds rise to fill the gap. A winner gives a home address that must match county records, one per home.</p>` : ''}
        <div class="small muted" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <span>ID <code>${esc(g.id)}</code>${fresh ? ' (set from the name; fixed once published)' : ''}</span>
          ${fresh ? '<button type="button" class="linkbtn" data-act="remove">Remove this promo</button>' : '<span>Published promos can be switched off, not deleted, so their codes still work.</span>'}
        </div>
      </div>
    </section>`;
  }).join('');
}

function giftAt(i) { return S.draft.gifts[i]; }

function onInput(e) {
  const t = e.target, f = t.dataset.f, card = t.closest('.gift');
  if (!f || !card || f === 'active') return;
  const i = Number(card.dataset.i);
  let v = t.value;
  if (f === 'weight') v = Math.round((parseFloat(v) || 0) * 100) / 100;
  if (f === 'value') v = Math.max(0, Math.round(parseFloat(v) || 0));
  if ((f === 'fill' || f === 'ink')) {
    if (!/^#[0-9a-f]{6}$/i.test(v)) return;   // wait until the hex is whole
    $$(`[data-f="${f}"]`, card).forEach((x) => { if (x !== t) x.value = v; });
    if (f === 'fill') card.style.setProperty('--gift', v);
  }
  edit((d) => {
    const g = d.gifts[i];
    if (f === 'name' && isNew(g)) {
      const was = g.id;
      g.id = slug(v, d.gifts, g);
      d.zones.forEach((z) => { if (z.gift === was) z.gift = g.id; });
    }
    g[f] = v;
  }, { quiet: true });
  if (f === 'name') { $('[data-k="title"]', card).textContent = v || 'New promo'; const code = card.querySelector('code'); if (code) code.textContent = giftAt(i).id; }
}

function onChange(e) {
  const t = e.target;
  if (t.dataset.f !== 'active') return;
  const i = Number(t.closest('.gift').dataset.i);
  edit((d) => {
    const g = d.gifts[i];
    g.active = t.checked;
    if (g.active && !(g.weight > 0)) g.weight = 5;
    // switched back on: put its slice where it was on the live dial, not at the end
    const at = S.live.config.zones.findIndex((z) => z.gift === g.id);
    if (g.active && at >= 0 && !d.zones.some((z) => z.gift === g.id)) d.zones.splice(Math.min(at, d.zones.length), 0, { gift: g.id, pct: g.weight, big: g.big, small: g.small });
  });
}

function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const card = b.closest('.gift'), i = Number(card.dataset.i);
  if (b.dataset.act === 'open') {
    const body = $('.gift-body', card), show = body.hidden;
    body.hidden = !show; b.setAttribute('aria-expanded', String(show));
    if (show) open.add(i); else open.delete(i);
  }
  if (b.dataset.act === 'remove') {
    const kept = [...open].filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));
    open.clear(); kept.forEach((x) => open.add(x));
    edit((d) => { const g = d.gifts[i]; d.gifts.splice(i, 1); d.zones = d.zones.filter((z) => z.gift !== g.id); });
  }
}

function addGift() {
  edit((d) => {
    const g = { id: '', name: 'New promo', short: 'NEW PROMO', sub: 'Describe what the winner gets', weight: 5, value: 25, fill: '#14284e', ink: '#f9f7f8', active: true, big: '$25 OFF', small: 'NEW PROMO' };
    g.id = slug(g.name, d.gifts, g);
    d.gifts.push(g);
    open.add(d.gifts.length - 1);
  });
  const cards = $$('.gift', root);
  const last = cards[cards.length - 1];
  if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('[data-f="name"]', last)?.select(); }
}

/* ---------------- the side panel ---------------- */

function drawSide() {
  if (!root || !$('#pv', root)) return;
  const d = S.draft;
  const byId = Object.fromEntries(d.gifts.map((g) => [g.id, g]));
  const on = activeGifts(d), M = d.membership.giftId, memOn = on.some((g) => g.id === M);
  drawFace($('#pv [data-arrd="face"]'), d.zones, byId, { topId: memOn ? M : null, ids: 'adm', tag: $('#pv [data-arrd="tag"]') });

  const total = Math.round(on.reduce((s, g) => s + (+g.weight || 0), 0) * 100) / 100;
  const ok = Math.abs(total - 100) < 0.005;
  $('#total').innerHTML = `<div class="total ${ok ? 'ok' : 'bad'}"><span>Total odds</span><span class="num">${pctOf(total)}${ok ? ' ✓' : total < 100 ? ` · ${pctOf(100 - total)} left to give` : ` · ${pctOf(total - 100)} too much`}</span></div>`;

  const without = oddsInPlay(d, false);
  $('#odds').innerHTML = `<div class="head2"><span>Promo</span><span>${memOn ? 'Odds · free year gone' : 'Odds'}</span></div>` + on.map((g) => `
    <div><span><i class="swatch" style="background:${esc(g.fill)}"></i><span>${esc(g.name)}</span></span>
    <span>${pctOf(g.weight)}${memOn ? ` · ${g.id === M ? '–' : fmtPct(without[g.id])}` : ''}</span></div>`).join('');

  $('#order').innerHTML = d.zones.map((z, i) => `
    <li><i class="swatch" style="background:${esc(byId[z.gift]?.fill)}"></i><span>${esc(byId[z.gift]?.name || z.gift)} <span class="muted num">${pctOf(z.pct)}</span></span>
      <button type="button" data-mv="-1" data-z="${i}" aria-label="Move toward cool" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" data-mv="1" data-z="${i}" aria-label="Move toward heat" ${i === d.zones.length - 1 ? 'disabled' : ''}>↓</button></li>`).join('');

  const { errors, warnings } = validateConfig(d, S.live.config);
  $('#checks').innerHTML = (errors.length ? `<div class="callout"><p><b>Fix before publishing</b></p><ul>${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '')
    + (warnings.length ? `<div class="callout blue"><p><b>Worth a look</b></p><ul>${warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
}

function onOrder(e) {
  const b = e.target.closest('[data-mv]');
  if (!b) return;
  const i = Number(b.dataset.z), j = i + Number(b.dataset.mv);
  edit((d) => { [d.zones[i], d.zones[j]] = [d.zones[j], d.zones[i]]; }, { quiet: true });
}

/* Hovering or editing a promo swings the needle onto its slice and names it in the centre, like a turn would. */
function pointAt(i) {
  const g = giftAt(i), pv = $('#pv', root);
  if (!g || !pv) return;
  let a = -135, at = null;
  for (const z of S.draft.zones) { const span = z.pct / 100 * 270; if (z.gift === g.id && at === null) at = a + span / 2; a += span; }
  if (at === null) return;
  $('[data-arrd="marker"]', pv).setAttribute('transform', `rotate(${at})`);
  $('[data-arrd="hubMain"]', pv).textContent = `${Math.round(50 + (at + 135) / 270 * 40)}°`;
  const sub = $('[data-arrd="hubSub"]', pv);
  sub.textContent = g.short; sub.setAttribute('font-size', hubSize(g.short).toFixed(1)); sub.setAttribute('fill', '#084e91');
}
