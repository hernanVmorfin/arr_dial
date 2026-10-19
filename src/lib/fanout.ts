/* What happens after a win, run after the response so the needle never waits on a third party:
 * Monday item (CSR queue) · Podium code text · Klaviyo event (reminder flow). Each one is independent; a failure is
 * logged and never undoes the win, which is already stored with its code.
 * The code text goes out at once. Monday and Klaviyo wait for the enrichment (lib/enrich.ts: home record, earlier
 * leads, Klaviyo profile), so the CSR's item is complete when it appears. */
import type { DialDb, Entry } from './db.ts';
import type { Cfg, Gift } from './dial.ts';
import { createDialItem, mondayConfigured, syncDialItem, updateDialItem } from './monday.ts';
import { podiumConfigured, sendCodeText } from './podium.ts';
import { klaviyoConfigured, sendProfile, sendRedeemed, sendVoided, sendWon } from './klaviyo.ts';
import { enrichAddress, enrichEntry } from './enrich.ts';

async function settle(label: string, tasks: Record<string, () => Promise<unknown>>) {
  const names = Object.keys(tasks);
  const results = await Promise.allSettled(names.map((n) => tasks[n]()));
  const errors = results.flatMap((r, i) => (r.status === 'rejected' ? [`${names[i]}: ${String(r.reason)}`] : []));
  if (errors.length) console.error(`dial ${label}`, errors.join(' | '));
  return { sent: names.filter((_, i) => results[i].status === 'fulfilled'), errors };
}

export function announceWin(env: unknown, db: DialDb, cfg: Cfg, e: Entry, gift: Gift) {
  const enriched = enrichEntry(env, db, e).catch((err) => { console.error('dial enrich', err); return e; });
  const tasks: Record<string, () => Promise<unknown>> = { enrich: () => enriched };
  if (podiumConfigured(env)) tasks.podium = () => sendCodeText(env, e, gift, cfg);
  if (mondayConfigured(env)) tasks.monday = async () => {
    const x = await enriched;
    const r = await createDialItem(env, x, gift, cfg);
    await db.updateEntry(e.id, { monday_item_id: r.itemId });
    if (r.detailsError) console.error('dial monday columns', r.detailsError);
  };
  if (klaviyoConfigured(env)) {
    tasks.klaviyo = async () => sendWon(env, await enriched, gift, cfg);
    // A separate call, so the Won event (it starts the reminder flow) never depends on it.
    tasks.klaviyoProfile = async () => { const x = await enriched; if (x.context?.ids?.kx || x.home) await sendProfile(env, x); };
  }
  return settle('win', tasks);
}

export async function announceDetails(env: unknown, db: DialDb, cfg: Cfg, entry: Entry, gift: Gift) {
  const e = await enrichAddress(db, entry);
  const tasks: Record<string, () => Promise<unknown>> = {};
  if (mondayConfigured(env)) tasks.monday = async () => {
    // The item is created right after the claim; give it a moment if the visitor was quick.
    let itemId = e.monday_item_id;
    for (let i = 0; !itemId && i < 3; i++) { await new Promise((r) => setTimeout(r, 1500)); itemId = (await db.entryByTurn(e.turn_id!))?.monday_item_id || null; }
    if (itemId) await updateDialItem(env, itemId, e, gift, cfg);
  };
  if (klaviyoConfigured(env)) tasks.klaviyo = () => sendProfile(env, e);
  return settle('details', tasks);
}

/** A code changed in the admin. Monday's item follows (status label, expiry in the CSR block); Klaviyo hears about a
 *  redemption or a void so the reminders stop. A restore or an extension can't recall reminders already queued. */
export function announceCodeChange(env: unknown, cfg: Cfg, e: Entry, gift: Gift, action: 'redeem' | 'void' | 'restore' | 'extend') {
  const tasks: Record<string, () => Promise<unknown>> = {};
  if (mondayConfigured(env) && e.monday_item_id) tasks.monday = () => syncDialItem(env, e.monday_item_id!, e, gift, cfg);
  if (klaviyoConfigured(env) && action === 'redeem') tasks.klaviyo = () => sendRedeemed(env, e, gift);
  if (klaviyoConfigured(env) && action === 'void') tasks.klaviyo = () => sendVoided(env, e, gift);
  return settle(`admin ${action}`, tasks);
}

export function announceRedeemed(env: unknown, e: Entry, gift: Gift) {
  const tasks: Record<string, () => Promise<unknown>> = {};
  if (klaviyoConfigured(env)) tasks.klaviyo = () => sendRedeemed(env, e, gift);
  return settle('redeemed', tasks);
}
