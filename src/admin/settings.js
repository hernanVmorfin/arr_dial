/* Settings: when the popup opens by itself, holds and limits, contact details and the rules status. Edits the same
 * draft as Promos & odds and publishes with it. Pausing the dial is the button in the bar above the tabs, because
 * it goes live at once. */
import { validateConfig } from '../lib/rules.js';
import { S, edit, on } from './store.js';
import { BASE, esc, $ } from './ui.js';

const get = (o, path) => path.split('.').reduce((x, k) => x[k], o);
const set = (o, path, v) => { const ks = path.split('.'), last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; };
const int = (v) => (v === '' ? NaN : Math.round(Number(v)));

/* [path, label, kind, hint, unit]. kind: int · pct (stored 0–1) · sec (stored ms) · text · url · list (one per line) ·
 * csv (comma separated) · bool */
const SECTIONS = [
  ['The popup', 'When it opens by itself. Buttons with data-arr-dial="open" and ?dial=1 links open it for everyone, always.', [
    ['popup.split', 'Visitors who get the popup', 'pct', '100% for everyone. Lower it to run a test: the rest are the control group and never see it open by itself. 0% for no one.', '%'],
    ['popup.delayMs', 'Opens after', 'sec', 'Seconds on the site this visit, counted across pages while it is on screen.', 'sec'],
    ['popup.snoozeDays', 'Then waits', 'int', 'Days before it opens by itself again for someone who closed it.', 'days'],
    ['popup.tab', 'Side tab', 'bool', 'After someone has seen the popup, a TURN THE DIAL tab stays on the right edge.'],
    ['popup.excludePaths', 'Pages where it never opens by itself', 'list', 'One path per line, like /book-service. Pages under a path count too.']
  ]],
  ['Holds, codes and limits', 'Shown to visitors and printed in the official rules.', [
    ['holdMinutes', 'Hold a won gift for', 'int', 'The countdown on the claim screen.', 'min'],
    ['expiresDays', 'Codes expire after', 'int', 'Counted from the claim. Reminder texts follow this.', 'days'],
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
        <div class="row cols-3">${fields.map(field).join('')}</div>
      </section>`).join('')}</div>
    <div class="checks" id="setChecks" style="margin-top:14px"></div>`;
  const box = $('#sets', main);
  box.addEventListener('input', onInput);
  box.addEventListener('change', onInput);
  drawChecks();
  off = on(() => drawChecks());
}
export function destroy() { if (off) off(); off = null; root = null; }

function onInput(e) {
  const t = e.target, path = t.dataset.p, kind = t.dataset.k;
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
  const { errors } = validateConfig(S.draft, S.live.config);
  const mine = errors.filter((x) => MINE.some((p) => x.startsWith(p)));
  box.innerHTML = mine.length ? `<div class="callout"><p><b>Fix before publishing</b></p><ul>${mine.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
}
