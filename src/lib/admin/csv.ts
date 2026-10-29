/* CSV downloads from the admin (Codes, Spins): Excel-safe cells, Chicago times, a BOM so Excel reads UTF-8. */

/* A cell that starts with = + - @ would run as a formula in Excel or Sheets; a leading ' keeps it text. */
export const cell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : '');

export const toCsv = (head: string[], lines: unknown[][]) => '﻿' + [head.join(','), ...lines.map((l) => l.map(cell).join(','))].join('\r\n') + '\r\n';

export function csvResponse(body: string, name: string, now: Date) {
  return new Response(body, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}-${now.toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store' }
  });
}
