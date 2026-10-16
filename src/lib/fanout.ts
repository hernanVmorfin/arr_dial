/* What happens after a win, run after the response so the needle never waits on a third party:
 * Monday item (CSR queue) · Podium code text · Klaviyo event (reminder flow). Each one is independent; a failure is
 * logged and never undoes the win, which is already stored with its code. */
import type { DialDb, Entry } from './db.ts';
import type { Cfg, Gift } from './dial.ts';
import { createDialItem, mondayConfigured, updateDialItem } from './monday.ts';
import { podiumConfigured, sendCodeText } from './podium.ts';
import { klaviyoConfigured, sendProfile, sendRedeemed, sendWon } from './klaviyo.ts';

async function settle(label: string, tasks: Record<string, () => Promise<unknown>>) {
  const names = Object.keys(tasks);
  const results = await Promise.allSettled(names.map((n) => tasks[n]()));
  const errors = results.flatMap((r, i) => (r.status === 'rejected' ? [`${names[i]}: ${String(r.reason)}`] : []));
  if (errors.length) console.error(`dial ${label}`, errors.join(' | '));
  return { sent: names.filter((_, i) => results[i].status === 'fulfilled'), errors };
}

export function announceWin(env: unknown, db: DialDb, cfg: Cfg, e: Entry, gift: Gift) {
  const tasks: Record<string, () => Promise<unknown>> = {};
  if (mondayConfigured(env)) tasks.monday = async () => {
    const r = await createDialItem(env, e, gift, cfg);
    await db.updateEntry(e.id, { monday_item_id: r.itemId });
    if (r.detailsError) console.error('dial monday columns', r.detailsError);
  };
  if (podiumConfigured(env)) tasks.podium = () => sendCodeText(env, e, gift, cfg);
  if (klaviyoConfigured(env)) tasks.klaviyo = () => sendWon(env, e, gift, cfg);
  return settle('win', tasks);
}

export async function announceDetails(env: unknown, db: DialDb, cfg: Cfg, e: Entry, gift: Gift) {
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

export function announceRedeemed(env: unknown, e: Entry, gift: Gift) {
  const tasks: Record<string, () => Promise<unknown>> = {};
  if (klaviyoConfigured(env)) tasks.klaviyo = () => sendRedeemed(env, e, gift);
  return settle('redeemed', tasks);
}
