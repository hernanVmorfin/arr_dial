/* The Comfort Dial admin, in the browser. Tabs by URL hash; the bar above them says whether the dial is live and
 * pauses it; the bar along the bottom appears while there are unpublished edits and publishes them. */
import { validateConfig } from '../lib/rules.js';
import { S, on, dirty, discard, loadLive, setLive, normalize } from './store.js';
import { diffConfigs } from './diff.js';
import { BASE, BOOT, api, esc, $, $$, dialog, confirmDialog, toast, ago } from './ui.js';
import * as promos from './promos.js';
import * as settings from './settings.js';
import * as codes from './codes.js';
import * as results from './results.js';
import * as history from './history.js';
import * as team from './team.js';

const TABS = { promos, settings, codes, results, history, team };
let current = null;

function route() {
  const name = (location.hash.slice(1) || 'promos').split('?')[0];
  const tab = TABS[name] ? name : 'promos';
  if (current && TABS[current].destroy) TABS[current].destroy();
  current = tab;
  $$('#tabs a').forEach((a) => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const main = $('#main');
  TABS[tab].render(main);
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

/* ---------------- live / paused ---------------- */

function drawState() {
  const L = S.live, live = L.config.enabled !== false;
  $('#state').innerHTML = `
    <span class="pill ${live ? 'live' : 'paused'}">${live ? 'Live on the site' : 'Paused'}</span>
    <span class="small muted">Version ${L.version}${L.created_at ? ` · published ${esc(ago(L.created_at))} by ${esc(L.created_by)}` : ' · the built-in config; nothing published yet'}</span>
    <span style="flex:1"></span>
    <button type="button" class="btn ${live ? 'quiet' : ''} sm" id="pauseBtn">${live ? 'Pause the dial' : 'Turn the dial back on'}</button>`;
  $('#pauseBtn').addEventListener('click', togglePause);
}

async function togglePause() {
  const pausing = S.live.config.enabled !== false;
  const ok = await confirmDialog(pausing ? 'Pause the dial?' : 'Turn the dial back on?',
    pausing ? 'It stops opening by itself and stops taking turns right away. The button on the site shows a call-us message instead. Anyone already holding a gift can still claim it.'
      : 'It goes back to opening by itself for the share of visitors in Settings, with the promos and odds that are live now.',
    pausing ? 'Pause now' : 'Turn it on', pausing ? 'red' : '');
  if (!ok) return;
  const r = await api('state', { method: 'POST', body: { enabled: !pausing } });
  if (!r.ok) { toast(r.error || 'That didn\'t go through.', true); return; }
  if (dirty()) {   // keep the edits in progress: only `enabled` changed underneath them
    S.live = { version: r.version, config: normalize(r.config), created_by: BOOT.me.email, created_at: new Date().toISOString(), note: null };
    S.draft.enabled = r.config.enabled;
    drawState(); drawDraft();
  } else await loadLive();
  toast(pausing ? 'The dial is paused. Visitors see a call-us message within 15 seconds.' : 'The dial is back on.');
}

/* ---------------- unpublished edits ---------------- */

function drawDraft() {
  const bar = $('#draftbar'), d = dirty();
  const changes = d ? diffConfigs(S.live.config, S.draft) : [];
  const promoChange = d && (JSON.stringify(S.draft.gifts) !== JSON.stringify(S.live.config.gifts) || JSON.stringify(S.draft.zones) !== JSON.stringify(S.live.config.zones));
  const settingsChange = d && JSON.stringify({ ...S.draft, gifts: 0, zones: 0 }) !== JSON.stringify({ ...S.live.config, gifts: 0, zones: 0 });
  $$('#tabs a').forEach((a) => {
    const show = (a.dataset.tab === 'promos' && promoChange) || (a.dataset.tab === 'settings' && settingsChange);
    const dot = $('.dot', a);
    if (show && !dot) a.insertAdjacentHTML('beforeend', '<span class="dot" aria-label="unpublished changes"></span>');
    if (!show && dot) dot.remove();
  });
  bar.hidden = !d;
  if (!d) return;
  const { errors } = validateConfig(S.draft, S.live.config);
  bar.innerHTML = `<div class="draftbar-in">
    <p><b>Not published yet:</b> ${changes.length ? esc(changes.slice(0, 2).join(' · ')) + (changes.length > 2 ? ` · and ${changes.length - 2} more` : '') : 'small edits'}${errors.length ? ` <span style="color:#ff8a8d">· ${errors.length} to fix first</span>` : ''}</p>
    <button type="button" class="btn quiet sm" id="discardBtn">Discard</button>
    <button type="button" class="btn red sm" id="publishBtn">Review &amp; publish</button></div>`;
  $('#discardBtn').addEventListener('click', async () => {
    if (await confirmDialog('Discard your edits?', 'The promos, odds and settings go back to what is live now.', 'Discard')) discard();
  });
  $('#publishBtn').addEventListener('click', publish);
}

async function publish() {
  const changes = diffConfigs(S.live.config, S.draft);
  const { errors, warnings } = validateConfig(S.draft, S.live.config);
  const oddsChanged = changes.some((c) => /odds|Switched|New promo/.test(c));
  const monthsChanged = changes.some((c) => c.startsWith('Free-year months'));
  const body = `
    <div><p class="label" style="margin:0 0 4px">What changes</p><ul>${changes.map((c) => `<li>${esc(c)}</li>`).join('') || '<li>Small edits</li>'}</ul></div>
    ${errors.length ? `<div class="callout"><p><b>Fix these first</b></p><ul>${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${warnings.length ? `<div class="callout blue"><p><b>Worth a look</b></p><ul>${warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${S.draft.rulesFinal && oddsChanged ? '<div class="callout"><p>The official rules are final. Publishing changes the odds printed on the rules page from this moment. Turns already taken keep the odds they were played under.</p></div>' : ''}
    ${S.draft.rulesFinal && monthsChanged ? '<div class="callout"><p>The official rules are final. Publishing changes the free-year months and the dates the rules page gives for the dial.</p></div>' : ''}
    <label class="f"><span>Note (optional)</span><textarea name="note" rows="2" maxlength="300" placeholder="Why: e.g. more free service calls for the cold snap"></textarea></label>
    <p class="err" id="pubErr"></p>
    <p class="small muted" style="margin:0">Goes live as version ${S.live.version + 1}. The popup, the rules page and new turns pick it up within 15 seconds.</p>`;
  await dialog({
    title: 'Publish these changes?', eyebrow: `Version ${S.live.version + 1}`, body,
    actions: [{ label: 'Keep editing', value: null }, {
      label: 'Publish', kind: 'red', run: async (d) => {
        if (errors.length) { $('#pubErr', d).textContent = 'Fix the items above first.'; return false; }
        const note = $('textarea', d).value;
        const r = await api('config', { method: 'POST', body: { config: S.draft, baseVersion: S.live.version, note } });
        if (!r.ok) {
          $('#pubErr', d).innerHTML = esc(r.error || 'Publishing failed. Nothing changed.') + (r.status === 409 ? ' <button type="button" class="linkbtn" id="reloadBtn">Reload the live version</button> (your edits here will be dropped).' : '');
          $('#reloadBtn', d)?.addEventListener('click', async () => { await loadLive(); d.close(); d.remove(); toast('Loaded the newest version.'); });
          return false;
        }
        setLive({ version: r.version, config: r.config, created_by: BOOT.me.email, created_at: new Date().toISOString(), note });
        toast(`Published version ${r.version}. Live on the site within 15 seconds.`);
        return true;
      }
    }]
  });
}

/* ---------------- your account ---------------- */

function menu() {
  const btn = $('#meBtn'), m = $('#meMenu');
  const close = () => { m.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); m.hidden = !m.hidden; btn.setAttribute('aria-expanded', String(!m.hidden)); });
  document.addEventListener('click', (e) => { if (!m.contains(e.target)) close(); });
  m.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    close();
    if (act === 'signout') {
      if (dirty() && !(await confirmDialog('Sign out?', 'Your unpublished edits will be lost.', 'Sign out'))) return;
      await api('logout', { method: 'POST' });
      window.removeEventListener('beforeunload', guard);
      location.href = `${BASE}admin/login`;
    }
    if (act === 'password') changePassword();
  });
}

function changePassword() {
  dialog({
    title: 'Change my password', body: `<form class="row" novalidate>
      <label class="f"><span>Current password</span><input type="password" name="current" autocomplete="current-password"></label>
      <label class="f"><span>New password</span><input type="password" name="next" minlength="12" autocomplete="new-password"><small>At least 12 characters.</small></label>
      <label class="f"><span>New password again</span><input type="password" name="again" autocomplete="new-password"></label>
      <p class="err"></p></form>`,
    actions: [{ label: 'Cancel', value: null }, {
      label: 'Change it', run: async (d) => {
        const f = Object.fromEntries(new FormData($('form', d)));
        if (f.next !== f.again) { $('.err', d).textContent = 'The new passwords don\'t match.'; return false; }
        const r = await api('password', { method: 'POST', body: { current: f.current, next: f.next } });
        if (!r.ok) { $('.err', d).textContent = r.error || 'Couldn\'t change it.'; return false; }
        toast('Password changed.');
        return true;
      }
    }]
  });
}

const guard = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } };

async function start() {
  const r = await loadLive();
  if (!r.ok) { $('#main').innerHTML = `<div class="callout"><p><b>The admin couldn't load the config.</b></p><p>${esc(r.error || '')} Reload the page to try again.</p></div>`; return; }
  $('#main').tabIndex = -1;
  on(() => { drawState(); drawDraft(); });
  drawState(); drawDraft(); menu();
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', guard);
  route();
  setInterval(checkLive, 60_000);
}

/* Someone else may publish or pause meanwhile. With no edits in progress, follow the new version; with edits, say
 * so once (publishing them would be refused, see publishConfig). */
let warned = 0;
async function checkLive() {
  const r = await api('config');
  if (!r.ok || r.version === S.live.version) { drawState(); return; }
  if (!dirty()) { setLive(r); toast(`Version ${r.version} was published by ${r.created_by}. You're looking at it now.`); return; }
  if (warned !== r.version) { warned = r.version; toast(`${r.created_by} published version ${r.version} while you were editing. Discard and redo your edits to publish them.`, true); }
}
start();
