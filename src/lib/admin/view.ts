/* A code as the admin shows it: the stored entry plus its status and its gift's name, value, colour and Sera line. */
import { codeStatus, type Entry } from '../db.ts';
import { giftById, type Cfg } from '../dial.ts';

export function codeView(e: Entry, cfg: Cfg, now: Date) {
  const g = giftById(cfg, e.gift);
  return { ...e, status: codeStatus(e, now), giftName: g.name, giftShort: g.short, giftValue: g.value, giftFill: g.fill, giftSera: g.seraLine || '' };
}
export type CodeView = ReturnType<typeof codeView>;
