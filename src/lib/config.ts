/* The live Comfort Dial config: the newest version published from the admin (Supabase comfort_dial_config), or the
 * built-in data/dial.json (version 0) until anyone publishes. Every API route, the rules page and the popup (through
 * /api/status) read it from here, so a publish reaches all of them.
 *
 * Each Worker isolate keeps what it read for TTL_MS, so a busy page doesn't hit Supabase for the config on every
 * request. A publish clears this isolate's copy at once; other isolates pick it up within TTL_MS. If Supabase can't
 * be read, the last good config is kept, and with none yet, the built-in one. */
import type { AdminDb } from './db.ts';
import type { Cfg } from './dial.ts';
import { expiryDays } from './rules.js';

const TTL_MS = 15_000;
let cached: { cfg: Cfg; at: number } | null = null;

export const withVersion = (config: unknown, version: number): Cfg => ({ ...(config as Cfg), version });

export async function liveConfig(db: Pick<AdminDb, 'latestConfig'> | null, builtIn: unknown, now = Date.now()): Promise<Cfg> {
  if (cached && now - cached.at < TTL_MS) return cached.cfg;
  if (!db) return withVersion(builtIn, 0);
  try {
    const row = await db.latestConfig();
    cached = { cfg: row ? withVersion(row.config, row.version) : withVersion(builtIn, 0), at: now };
  } catch (e) {
    console.error('dial config', e);
    cached = { cfg: cached?.cfg || withVersion(builtIn, 0), at: now };
  }
  return cached.cfg;
}

export function forgetConfig() { cached = null; }

/** What the popup needs, sent with /api/status. Nothing in the config is secret, but switched-off gifts, code
 *  prefixes and Sera lines stay home. Each gift carries how many days its code lasts. */
export function publicConfig(cfg: Cfg) {
  return {
    version: cfg.version ?? 0,
    phone: cfg.phone, bookUrl: cfg.bookUrl, expiresDays: cfg.expiresDays, holdMinutes: cfg.holdMinutes,
    membershipGiftId: cfg.membership.giftId,
    gifts: cfg.gifts.filter((g) => g.active !== false).map((g) => {
      const { id, short, name, sub, weight, value, fill, ink } = g;
      return { id, short, name, sub, weight, value, fill, ink, expiresDays: expiryDays(cfg, g) };
    }),
    zones: cfg.zones,
    popup: cfg.popup
  };
}
