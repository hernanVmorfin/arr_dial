/* Settings: when the popup opens by itself, which months have a free year, holds and limits, contact details and
 * the rules status. Edits the same draft as Promos & odds and publishes with it. Pausing the dial is the button in
 * the bar above the tabs, because it goes live at once. */
import { chicagoMonth, freeYearStatus, membershipActive, membershipsLeft, monthName, scarcityLine, validateConfig } from '../lib/rules.js';
import { S, edit, on } from './store.js';
import { BASE, api, esc, $, fmtDate, fmtPhone, fmtShortWhen } from './ui.js';
import { openCode } from './codes.js';

const get = (o, path) => path.split('.').reduce((x, k) => x[k], o);
const set = (o, path, v) => { const ks = path.split('.'), last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; };
const int = (v) => (v === '' ? NaN : Math.round(Number(v)));

/* [path, label, kind, hint, unit]. kind: int · pct (stored 0–1) · sec (stored ms) · text · url · list (one per line) ·
 * csv (comma separated) · bool. A section whose fields is a function draws itself (the free-year schedule). */
const SECTIONS = [
  ['The popup', 'When it opens by itself. Buttons with data-arr-dial="open" and ?dial=1 links open it for everyone, always.', [
    ['popup.split', 'Visitors who get the popup', 'pct', '100% for everyone. Lower it to run a test: the rest are the control group and never see it open by itself. 0% for no one.', '%'],
    ['popup.delayMs', 'Opens after', 'sec', 'Seconds on the site this visit, counted across pages while it is on screen.', 'sec'],
    ['popup.snoozeDays', 'Then waits', 'int', 'Days before it opens by itself again for someone who closed it.', 'days'],
    ['popup.tab', 'Side tab', 'bool', 'After someone has seen the popup, a TURN THE DIAL tab stays on the right edge.'],
    ['popup.excludePaths', 'Pages where it never opens by itself', 'list', 'One path per line, like /book-service. Pages under a path count too.']
  ]],
  ['Free-year schedule', 'One free year of membership in each ticked month, Chicago time. The line under the dial and the official rules follow what you publish.', schedule],
  ['Holds, codes and limits', 'Shown to visitors and printed in the official rules.', [
    ['holdMinutes', 'Hold a won gift for', 'int', 'The countdown on the claim screen.', 'min'],
    ['expiresDays', 'Codes expire after', 'int', 'Counted from the claim. The default: a promo can set its own in Promos & odds. Reminder texts follow it.', 'days'],
    ['limits.turnsPerDevicePerDay', 'Turns per device per day', 'int', 'Per browser, rolling 24 hours.', 'turns'],
    ['limits.turnsPerIpPerDay', 'Turns per connection per day', 'int', 'Per IP address. Keep it well above the device limit: households and offices share one.', 'turns'],
    ['limits.claimsPerIpPerDay', 'Claims per connection per day', 'int', 'Codes issued per IP address.', 'codes']
  ]],
  ['Contact and service area', '', [
    ['phone', 'Phone', 'text', 'In the popup, the code text and the rules. Format: (708) 671-0813.'],
    ['bookUrl', 'Book online link', 'url', 'The BOOK ONLINE button after a win.'],
    ['zipPrefixes', 'Service-area ZIP prefixes', 'csv', 'Comma separated, like 604, 605, 606. An address outside these can\'t take the free year.']
  ]],
  ['Official rules', '', [
    ['season', 'Season name', 'text', 'For your own reference in the config.'],
    ['rulesFinal', 'The rules are final', 'bool', 'Off: the rules page says it is a draft. Switch on after the legal read.']
  ]]
];

function field([path, label, kind, hint, unit]) {
  const v = get(S.draft, path);
  const id = `s-${path.replace(/\./g, '-')}`;
  if (kind === 'bool') return `<div class="f"><label class="switch"><input type="checkbox" id="${id}" data-p="${path}" data-k="${kind}" ${v ? 'checked' : ''}><i></i>${esc(label)}</label><small class="hint">${esc(hint)}</small></div>`;
  let shown = v, type = 'number', attrs = '';
  if (kind === 'pct') { shown = Math.round(v * 1000) / 10; attrs = 'min="0" max="100" step="5"'; }
  if (kind === 'sec') { shown = v / 1000; attrs = 'min="0" max="60" step="0.5"'; }
  if (kind === 'int') attrs = 'min="0" step="1"';
  if (kind === 'text') type = 'text';
  if (kind === 'url') type = 'url';
  if (kind === 'csv') { type = 'text'; shown = v.join(', '); }
  if (kind === 'list') return `<label class="f" style="grid-column:1/-1"><span>${esc(label)}</span><textarea id="${id}" data-p="${path}" data-k="${kind}" rows="5">${esc(v.join('\n'))}</textarea><small>${esc(hint)}</small></label>`;
  const input = `<input type="${type}" id="${id}" data-p="${path}" data-k="${kind}" value="${esc(shown)}" ${attrs}>`;
  return `<label class="f"><span>${esc(label)}</span>${unit ? `<div class="unit">${input}<b>${esc(unit)}</b></div>` : input}<small>${esc(hint)}</small></label>`;
}

let root = null, off = null;
export function render(main) {
  root = main;
  main.innerHTML = `
    <div class="head"><div>
      <p class="eyebrow">How the dial behaves</p><h1>Settings</h1>
      <p class="muted">These publish together with Promos &amp; odds. To stop the dial right now, use <b>Pause the dial</b> above.</p>
    </div><a class="btn ghost" href="${BASE}rules" target="_blank" rel="noopener">See the rules page</a></div>
    <div id="sets">${SECTIONS.map(([title, sub, fields]) => `
      <section class="card">
        <h2>${esc(title)}</h2>${sub ? `<p class="muted small" style="margin:-6px 0 12px">${esc(sub)}</p>` : ''}
        ${typeof fields === 'function' ? `<div id="fyBody">${fields()}</div>` : `<div class="row cols-3">${fields.map(field).join('')}</div>`}
      </section>`).join('')}</div>
    <div class="checks" id="setChecks" style="margin-top:14px"></div>`;
  const box = $('#sets', main);
  box.addEventListener('input', onInput);
  box.addEventListener('change', onInput);
  box.addEventListener('click', onClick);
  drawChecks();
  off = on(() => { drawChecks(); drawSchedule(); });
  loadFreeYears();
}
export function destroy() { if (off) off(); off = null; root = null; }

function onInput(e) {
  const t = e.target, path = t.dataset.p, kind = t.dataset.k;
  if (t.dataset.month) { if (e.type === 'change') toggleMonth(t.dataset.month, t.checked); return; }
  if (!path) return;
  if (kind === 'bool' && e.type !== 'change') return;
  let v;
  if (kind === 'bool') v = t.checked;
  else if (kind === 'pct') v = t.value === '' ? NaN : Math.round(Number(t.value) * 10) / 1000;
  else if (kind === 'sec') v = t.value === '' ? NaN : Math.round(Number(t.value) * 1000);
  else if (kind === 'int') v = int(t.value);
  else if (kind === 'list') v = t.value.split(/\n/).map((x) => x.trim()).filter(Boolean);
  else if (kind === 'csv') v = t.value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  else v = t.value;
  edit((d) => set(d, path, v), { quiet: true });
}

/* The validateConfig messages about this tab's fields (rules.js words them; Promos & odds shows the rest). */
const MINE = ['Dial on/off', 'Rules status', 'Season name', 'Phone', 'Book online', 'Codes expire', 'Hold time', 'Service area', 'Turns per', 'Claims per', 'Share of visitors', 'Popup delay', 'Snooze', 'Pages without', 'Side tab', 'Free-year months'];

function drawChecks() {
  const box = root && $('#setChecks', root);
  if (!box) return;
  const { errors } = validateConfig(S.draft, S.live.config, { month: thisMonth(), claimed: wonMonths() });
  const mine = errors.filter((x) => MINE.some((p) => x.startsWith(p)));
  box.innerHTML = mine.length ? `<div class="callout"><p><b>Fix before publishing</b></p><ul>${mine.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
}

/* ---------------- free-year schedule ----------------
 * A tick per month: the months already on the schedule (past ones too), this month and the next ones. Each says what
 * the database has for it: won (by whom, with the code), held on someone's claim screen, up for grabs, scheduled, or
 * ended with no winner. A won month can't be unticked: the official rules print it. A month that has ended can't be
 * added. Holds free themselves when their countdown runs out, so there is nothing to release by hand. */

let fy = null, fyErr = '', ahead = 12;
const thisMonth = () => fy?.month || chicagoMonth();
const wonMonths = () => (fy?.rows || []).filter((r) => r.state === 'won').map((r) => r.month);
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function loadFreeYears() {
  const r = await api('membership');
  if (!root) return;
  if (r.ok) { fy = r; fyErr = ''; } else fyErr = r.error || 'Couldn\'t load who won which month.';
  drawSchedule(); drawChecks();
}

function toggleMonth(month, add) {
  edit((d) => {
    const months = new Set(d.membership.months);
    if (add) months.add(month); else months.delete(month);
    d.membership.months = [...months].sort();
  }, { quiet: true });
}

function onClick(e) {
  const code = e.target.closest('[data-fy-code]');
  if (code) { e.preventDefault(); openCode(code.dataset.fyCode); return; }
  if (e.target.closest('[data-fy-more]')) { ahead = Math.min(ahead + 12, 36); drawSchedule(); $('[data-fy-more]', root)?.focus(); }
}

function schedule() {
  const now = thisMonth(), draft = S.draft.membership.months, live = S.live.config.membership.months;
  const rows = Object.fromEntries((fy?.rows || []).map((r) => [r.month, r]));
  const won = wonMonths();
  const shown = new Set([...draft, ...live, ...Object.values(rows).filter((r) => r.state === 'won' || r.month >= now).map((r) => r.month)]);
  for (let i = 0; i < ahead; i++) shown.add(addMonths(now, i));
  const months = [...shown].sort();

  const tiles = months.map((m) => {
    const r = rows[m], ticked = draft.includes(m), was = live.includes(m);
    const locked = ticked && r?.state === 'won';
    let tag = '', note = '';
    if (r?.state === 'won') {
      const e = r.entry;
      tag = '<span class="tag won">Won</span>';
      note = e ? `${esc(e.first_name || fmtPhone(e.phone))} · <a href="#" data-fy-code="${esc(e.code)}">${esc(e.code)}</a> · ${esc(fmtDate(r.claimed_at))}` : `Won ${esc(fmtDate(r.claimed_at))}, but no code is on file.`;
    } else if (r?.state === 'held') {
      tag = '<span class="tag held">Held</span>';
      note = `On someone's claim screen until ${esc(fmtShortWhen(r.held_until))}. If they don't claim it, it's back in play.`;
    } else if (!ticked) note = m < now ? 'Ended. No free year.' : m === now ? 'No free year this month.' : 'No free year.';
    else if (m < now) { tag = '<span class="tag missed">Not won</span>'; note = 'Ended with no winner.'; }
    else if (m === now) { tag = '<span class="tag open">Up for grabs</span>'; note = 'In play now.'; }
    else { tag = '<span class="tag soon">Scheduled</span>'; note = `Unlocks ${esc(monthName(m, { year: false }).slice(0, 3))} 1.`; }
    if (ticked !== was) note += ` <b>${ticked ? 'Added' : 'Removed'}, not published yet.</b>`;
    const cls = ['fy', ticked && 'is-on', m < now && 'is-past', m === now && 'is-now', ticked !== was && 'is-changed'].filter(Boolean).join(' ');
    return `<label class="${cls}"${locked ? ' title="Won, so it stays on the schedule and in the official rules."' : ''}>
      <input type="checkbox" data-month="${m}" ${ticked ? 'checked' : ''} ${locked ? 'disabled' : ''}>
      <span class="fy-m"><b>${esc(monthName(m, { year: false }))}</b> <span class="muted">${m.slice(0, 4)}</span></span>${tag}
      <small>${note}</small></label>`;
  }).join('');

  const on = membershipActive(S.draft), changed = JSON.stringify(draft) !== JSON.stringify(live);
  const left = membershipsLeft(S.draft, now, won), gone = draft.filter((m) => won.includes(m)).length;
  const line = scarcityLine(freeYearStatus(S.draft, now, won));
  return `
    <p class="fy-sum"><b>${plural(draft.length, 'month')} with a free year</b> · ${gone} won · ${left} still to come</p>
    ${on ? (line ? `<p class="small" style="margin:4px 0 0">Under the dial${changed ? ', once you publish' : ''}: <q class="fy-line">${esc(line)}</q></p>` : '')
      : '<div class="callout blue" style="margin-top:8px"><p>The free year is switched off in Promos &amp; odds, so no month gives one until it\'s back on.</p></div>'}
    ${fyErr ? `<p class="err" style="margin-top:8px">${esc(fyErr)} Won and held months can't be shown.</p>` : !fy ? '<p class="small muted" style="margin:6px 0 0">Loading who won which month…</p>' : ''}
    <div class="fy-grid" role="group" aria-label="Months with a free year">${tiles}</div>
    ${ahead < 36 ? '<button type="button" class="linkbtn small" data-fy-more style="margin-top:10px">Show 12 more months</button>' : ''}`;
}

function drawSchedule() {
  const box = root && $('#fyBody', root);
  if (!box) return;
  const focused = document.activeElement?.dataset?.month;
  box.innerHTML = schedule();
  if (focused) $(`[data-month="${focused}"]`, box)?.focus();
}
