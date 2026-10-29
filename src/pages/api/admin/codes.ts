import type { APIRoute } from 'astro';
import { configFor, dbFor, envOf } from '../../../lib/runtime.ts';
import type { CodeStatus, Entry } from '../../../lib/db.ts';
import { chicagoDate } from '../../../lib/rules.js';
import { adminJson } from '../../../lib/admin/http.ts';
import { csvResponse, toCsv, when } from '../../../lib/admin/csv.ts';
import { codeView as view, type CodeView } from '../../../lib/admin/view.ts';

/* GET /api/admin/codes?q=&status=&gift=&page= → { rows, total, page, pageSize }
 *     q is a code (ARR-7K3P or 7K3P), part of a phone number, or a name or street.
 * GET /api/admin/codes?format=csv&… → the same filter as a CSV download (up to 5,000 codes). */
const PAGE = 50, CSV_MAX = 5000;
const STATUSES: CodeStatus[] = ['issued', 'redeemed', 'expired', 'void'];

export const GET: APIRoute = async ({ locals, url }) => {
  const db = dbFor(envOf(locals))!;
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
      return csvResponse(codesCsv(rows.map((e) => view(e, cfg, now))), 'comfort-dial-codes', now);
    }
    const page = Math.max(1, Math.min(1000, Number(p.get('page')) || 1));
    const r = await db.searchEntries({ q, status, gift, limit: PAGE, offset: (page - 1) * PAGE, now });
    return adminJson({ rows: r.rows.map((e) => view(e, cfg, now)), total: r.total, page, pageSize: PAGE });
  } catch (e) {
    console.error('dial admin codes', e);
    return adminJson({ error: 'Couldn\'t search the codes.' }, 502);
  }
};

function codesCsv(rows: CodeView[]) {
  const head = ['Code', 'Status', 'Gift', 'Value', 'Phone', 'First name', 'Address', 'ZIP', 'Won (Chicago)', 'Expires', 'Redeemed', 'Redeemed note', 'Voided', 'Void reason', 'Reminder texts', 'Source', 'Campaign', 'Page'];
  return toCsv(head, rows.map((e) => [
    e.code, e.status, e.giftName, e.giftValue, e.phone, e.first_name, e.address, e.zip, when(e.created_at), chicagoDate(e.expires_at),
    when(e.redeemed_at), e.redeemed_note, when(e.voided_at), e.voided_note, e.sms_marketing ? 'yes' : 'no', e.utm?.utm_source, e.utm?.utm_campaign, e.page
  ]));
}
