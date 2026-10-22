import type { APIRoute } from 'astro';
import { configFor, dbFor, envOf } from '../../../lib/runtime.ts';
import { parseSearch, type CodeStatus, type Entry } from '../../../lib/db.ts';
import { chicagoDate } from '../../../lib/rules.js';
import { adminJson } from '../../../lib/admin/http.ts';
import { codeView as view, type CodeView } from '../../../lib/admin/view.ts';

/* GET /api/admin/codes?q=&status=&gift=&page= → { rows, total, page, pageSize, typo? }
 *     q is a code (SVC20-7K3PK, or just 7K3PK), part of a phone number, or a name or street. typo: q looked like a
 *     code but its check character fails, and nothing matched it as text either.
 * GET /api/admin/codes?format=csv&… → the same filter as a CSV download (up to 5,000 codes). Admins only: it is
 *     every winner's phone number. */
const PAGE = 50, CSV_MAX = 5000;
const STATUSES: CodeStatus[] = ['issued', 'redeemed', 'expired', 'void'];

export const GET: APIRoute = async ({ locals, url }) => {
  const db = dbFor(envOf(locals))!;
  if (url.searchParams.get('format') === 'csv' && locals.admin!.role !== 'admin') return adminJson({ error: 'Only admins can export codes.' }, 403);
  const p = url.searchParams;
  const status = STATUSES.includes(p.get('status') as CodeStatus) ? (p.get('status') as CodeStatus) : undefined;
  const gift = /^[a-z0-9_]{2,24}$/.test(p.get('gift') || '') ? p.get('gift')! : undefined;
  const q = (p.get('q') || '').slice(0, 60);
  const now = new Date();
  try {
    const cfg = await configFor(db);
    if (p.get('format') === 'csv') {
      const rows: Entry[] = [];
      for (let offset = 0; offset < CSV_MAX; offset += 1000) {
        const r = await db.searchEntries({ q, status, gift, limit: 1000, offset, now });
        rows.push(...r.rows);
        if (r.rows.length < 1000) break;
      }
      return new Response(toCsv(rows.map((e) => view(e, cfg, now))), {
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="comfort-dial-codes-${now.toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store' }
      });
    }
    const page = Math.max(1, Math.min(1000, Number(p.get('page')) || 1));
    const r = await db.searchEntries({ q, status, gift, limit: PAGE, offset: (page - 1) * PAGE, now });
    const asked = parseSearch(q), typo = !r.total && asked && 'typo' in asked ? asked.typo : undefined;
    return adminJson({ rows: r.rows.map((e) => view(e, cfg, now)), total: r.total, page, pageSize: PAGE, typo });
  } catch (e) {
    console.error('dial admin codes', e);
    return adminJson({ error: 'Couldn\'t search the codes.' }, 502);
  }
};

/* A cell that starts with = + - @ would run as a formula in Excel or Sheets; a leading ' keeps it text. */
const cell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : '');

function toCsv(rows: CodeView[]) {
  const head = ['Code', 'Status', 'Gift', 'Value', 'Sera line', 'Phone', 'First name', 'Address', 'ZIP', 'Won (Chicago)', 'Expires', 'Redeemed', 'Redeemed note', 'Voided', 'Void reason', 'Reminder texts', 'Source', 'Campaign', 'Page'];
  const lines = rows.map((e) => [
    e.code, e.status, e.giftName, e.giftValue, e.giftSera, e.phone, e.first_name, e.address, e.zip, when(e.created_at), chicagoDate(e.expires_at),
    when(e.redeemed_at), e.redeemed_note, when(e.voided_at), e.voided_note, e.sms_marketing ? 'yes' : 'no', e.utm?.utm_source, e.utm?.utm_campaign, e.page
  ].map(cell).join(','));
  return '﻿' + [head.join(','), ...lines].join('\r\n') + '\r\n';
}
