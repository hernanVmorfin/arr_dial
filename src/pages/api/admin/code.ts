import type { APIRoute } from 'astro';
import { afterResponse, configFor, dbFor, envOf } from '../../../lib/runtime.ts';
import { codeAction, codeProblem } from '../../../lib/admin/service.ts';
import { giftById } from '../../../lib/dial.ts';
import { readCode } from '../../../lib/rules.js';
import { announceCodeChange } from '../../../lib/fanout.ts';
import { podiumConfigured, sendCodeText } from '../../../lib/podium.ts';
import { adminJson, readBody } from '../../../lib/admin/http.ts';
import { clientIp } from '../../../lib/http.ts';
import { codeView as view } from '../../../lib/admin/view.ts';

/* GET  /api/admin/code?code=SVC20-7K3PK → { entry, history }: one code with everything done to it. A code whose
 *      check character fails gets 400 saying a character is off.
 * POST /api/admin/code { code, action, note?, days? } → { ok, entry, history }
 *      action: redeem · void (note = the reason) · restore · extend (days) · resend (texts the code again).
 *      A CSR may redeem and resend only.
 *      Monday and Klaviyo follow after the response; a resend waits for Podium so you see whether it went. */
async function load(db: NonNullable<ReturnType<typeof dbFor>>, code: string) {
  const [entry, history, cfg] = await Promise.all([db.entryByCode(code), db.auditFor(code, 50), configFor(db)]);
  return entry ? { entry: view(entry, cfg, new Date()), history } : null;
}

export const GET: APIRoute = async ({ locals, url }) => {
  const code = readCode(url.searchParams.get('code'));
  const problem = codeProblem(code);
  if (problem || !code) return adminJson({ error: problem }, 400);
  try {
    const r = await load(dbFor(envOf(locals))!, code);
    return r ? adminJson(r) : adminJson({ error: `No code ${code}.` }, 404);
  } catch (e) { console.error('dial admin code', e); return adminJson({ error: 'Couldn\'t load that code.' }, 502); }
};

export const POST: APIRoute = async (ctx) => {
  const env = envOf(ctx.locals);
  const db = dbFor(env)!;
  const body = await readBody(ctx.request, 4000);
  if (!body) return adminJson({ error: 'Bad request.' }, 400);
  try {
    const cfg = await configFor(db);
    if (body.action === 'resend' && !podiumConfigured(env)) return adminJson({ error: 'Texting isn\'t set up (no Podium keys), so nothing was sent.' }, 409);
    const a = ctx.locals.admin!;
    const res = await codeAction(db, { code: body.code, action: body.action, note: body.note, days: body.days, by: a.email, role: a.role, ip: clientIp(ctx.request, () => ctx.clientAddress) });
    if (!res.ok) return adminJson({ error: res.error }, res.status);
    const gift = giftById(cfg, res.entry.gift);
    if (res.action === 'resend') {
      try { await sendCodeText(env, db, res.entry, gift, cfg); }
      catch (e) { console.error('dial admin resend', e); return adminJson({ error: 'Podium didn\'t take the text. Try again, or give the customer the code by phone.' }, 502); }
    } else {
      await afterResponse(ctx.locals, announceCodeChange(env, cfg, res.entry, gift, res.action));
    }
    return adminJson({ ok: true, ...(await load(db, res.entry.code)) });
  } catch (e) {
    console.error('dial admin code action', e);
    return adminJson({ error: 'That didn\'t go through. Try again in a minute.' }, 502);
  }
};
