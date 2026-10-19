/* History: every published version, newest first, what changed in it and who published it. Restoring an old one
 * publishes it again as a new version, so nothing is ever lost. */
import { S, dirty, loadLive, normalize } from './store.js';
import { diffConfigs } from './diff.js';
import { api, esc, $, confirmDialog, toast, fmtWhen } from './ui.js';

let root = null;
export function render(main) {
  root = main;
  main.innerHTML = `
    <div class="head"><div>
      <p class="eyebrow">Every change, kept</p><h1>History</h1>
      <p class="muted">Each publish is a version. Each turn records the version whose odds picked its gift. Restoring an old version publishes it again as a new one.</p>
    </div></div>
    <section class="card" id="vers"><p class="muted">Loading…</p></section>`;
  $('#vers', main).addEventListener('click', onRestore);
  load();
}
export function destroy() { root = null; }

async function load() {
  const r = await api('versions');
  if (!root) return;
  const box = $('#vers', root);
  if (!r.ok) { box.innerHTML = `<p class="err">${esc(r.error)}</p>`; return; }
  const vs = r.versions.map((v) => ({ ...v, config: normalize(v.config) }));
  box.innerHTML = vs.map((v, i) => {
    const older = vs[i + 1];
    const changes = v.version === 0 ? ['The starting config, from the code (data/dial.json)'] : diffConfigs(older ? older.config : null, v.config);
    const live = v.version === S.live.version;
    const odds = v.config.gifts.filter((g) => g.active !== false).map((g) => `<span class="chip"><i class="swatch" style="background:${esc(g.fill)}"></i>${esc(g.short)} ${Number(g.weight)}%</span>`).join('');
    return `<div class="ver">
      <div class="n">v${v.version}</div>
      <div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${live ? '<span class="tag live">Live now</span>' : ''}${v.config.enabled === false ? '<span class="tag void">Paused</span>' : ''}
          <span class="small muted">${v.created_at ? `${esc(fmtWhen(v.created_at))} · ${esc(v.created_by)}` : 'Built in'}</span></div>
        ${v.note ? `<p style="margin:6px 0 0"><b>${esc(v.note)}</b></p>` : ''}
        <ul>${changes.slice(0, 12).map((c) => `<li>${esc(c)}</li>`).join('')}${changes.length > 12 ? `<li>…and ${changes.length - 12} more</li>` : ''}${!changes.length ? '<li class="muted">No changes from the version before</li>' : ''}</ul>
        <div class="chips" style="margin-top:8px">${odds}</div>
      </div>
      <div>${live ? '' : `<button type="button" class="btn quiet sm" data-restore="${v.version}">Restore</button>`}</div>
    </div>`;
  }).join('') || '<div class="empty">Nothing published yet.</div>';
}

async function onRestore(e) {
  const b = e.target.closest('[data-restore]');
  if (!b) return;
  const v = Number(b.dataset.restore);
  const ok = await confirmDialog(`Restore version ${v}?`,
    `Its promos, odds and settings go live again as version ${S.live.version + 1}. Promos added since stay in the list, switched off.${dirty() ? ' <b>Your unpublished edits will be dropped.</b>' : ''}`, `Restore v${v}`, '');
  if (!ok) return;
  const r = await api('rollback', { method: 'POST', body: { version: v, baseVersion: S.live.version } });
  if (!r.ok) { toast(r.error || 'The restore didn\'t go through.', true); return; }
  await loadLive();
  toast(`Version ${v} is live again as version ${r.version}.`);
  if (root) load();
}
