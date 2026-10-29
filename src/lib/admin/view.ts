/* A code as the admin shows it: the stored entry plus its status and its gift's name, value and colour. A spin
 * likewise: the turn, what came of it, the code it became (if any) and how many times that device has turned. */
import { codeStatus, turnOutcome, type Entry, type Turn } from '../db.ts';
import { giftById, type Cfg } from '../dial.ts';

export function codeView(e: Entry, cfg: Cfg, now: Date) {
  const g = giftById(cfg, e.gift);
  return { ...e, status: codeStatus(e, now), giftName: g.name, giftShort: g.short, giftValue: g.value, giftFill: g.fill };
}
export type CodeView = ReturnType<typeof codeView>;

export function spinView(t: Turn, e: Entry | null, deviceTurns: number, cfg: Cfg, now: Date) {
  const g = giftById(cfg, t.gift);
  return {
    id: t.id, created_at: t.created_at, held_until: t.held_until, claimed_at: t.claimed_at, outcome: turnOutcome(t, now),
    gift: t.gift, giftName: g.name, giftShort: g.short, giftValue: g.value, giftFill: g.fill,
    device: t.device, deviceTurns, ip: t.ip, context: t.context || null,
    code: e?.code || null, codeStatus: e ? codeStatus(e, now) : null, phone: e?.phone || null, first_name: e?.first_name || null
  };
}
export type SpinView = ReturnType<typeof spinView>;
