/* The config being edited. `live` is what's published (from /api/admin/config); `draft` is a working copy the
 * Promos and Settings tabs edit. Publishing sends the draft with the version it started from, so a second editor
 * can't overwrite a newer publish. Gift dial labels (big/small) live on the zones; the draft copies them onto each
 * gift so the editor has one field per gift, and layoutZones writes them back. */
import { layoutZones } from '../lib/rules.js';
import { api } from './ui.js';

export const S = { live: null, draft: null, listeners: new Set() };
const clone = (o) => JSON.parse(JSON.stringify(o));

/** The config with each active gift's dial labels on the gift and the zones laid out: the shape both sides of a
 *  comparison are put in, so "no change" really means no change. */
export function normalize(cfg) {
  const c = clone(cfg);
  for (const g of c.gifts) {
    const z = c.zones.find((x) => x.gift === g.id);
    if (g.big == null) g.big = z ? z.big : '';
    if (g.small == null) g.small = z ? z.small : '';
    if (g.active == null) g.active = true;
  }
  c.zones = layoutZones(c.zones, c.gifts);
  delete c.version;
  return c;
}

export function setLive(row) {
  S.live = { ...row, config: normalize(row.config) };
  S.draft = clone(S.live.config);
  emit();
}

/** Change the draft. `fn` edits it in place; the dial is laid out again afterwards. */
export function edit(fn, { quiet = false } = {}) {
  fn(S.draft);
  S.draft.zones = layoutZones(S.draft.zones, S.draft.gifts);
  emit(quiet);
}
export const dirty = () => !!S.live && JSON.stringify(S.draft) !== JSON.stringify(S.live.config);
export function discard() { S.draft = clone(S.live.config); emit(); }

export function on(fn) { S.listeners.add(fn); return () => S.listeners.delete(fn); }
function emit(quiet = false) { for (const fn of S.listeners) fn({ quiet }); }

export async function loadLive() {
  const r = await api('config');
  if (r.ok) setLive(r);
  return r;
}
