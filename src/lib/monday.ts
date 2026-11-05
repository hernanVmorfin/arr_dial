/* Monday: each claim becomes a lead on the configured board. Shared contact columns retain their IDs;
 * MONDAY_DIAL_COLUMNS supplies the dedicated gift, date and attribution columns. Older deployments retain
 * the descriptive item name until the separate gift-code column is mapped. */
import { chicagoDate, chicagoDay, fmtPhone } from './rules.js';
import { homeHints, homeLine, priorLine, visitLine } from './profile.js';
import { envVar } from './env.ts';
import type { Entry, Lead } from './db.ts';
import type { Cfg, Gift } from './dial.ts';

export const MONDAY_COLUMNS = {
  address: 'text_mm7e3yt7', phone: 'phone_mm7exyxr', status: 'color_mm7er84n', quote: 'long_text_mm7v8j9w', source: 'lead_source'
} as const;

export const mondayConfigured = (env: unknown) => !!(envVar(env, 'MONDAY_API_TOKEN') && envVar(env, 'MONDAY_BOARD_ID'));

export function itemName(e: Entry, gift: Gift, structured = false) {
  if (structured) return e.first_name || e.code;
  return `${e.first_name ? `${e.first_name} · ` : ''}Comfort Dial ${e.code}: ${gift.name}`;
}

type DialColumnKey = 'gift' | 'code' | 'value' | 'claimed' | 'expires' | 'zip' | 'campaign' | 'landing' | 'smsConsent' | 'property';
type DialColumns = Partial<Record<DialColumnKey, string>>;

/** Optional mappings keep older deployments compatible while the dedicated board is configured. */
function dialColumns(env: unknown): DialColumns {
  const raw = envVar(env, 'MONDAY_DIAL_COLUMNS');
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MONDAY_DIAL_COLUMNS must be an object');
  return parsed as DialColumns;
}

function structuredColumns(e: Entry, gift: Gift, columns: DialColumns) {
  const values: Record<string, unknown> = {};
  const put = (key: DialColumnKey, value: unknown) => {
    const id = columns[key];
    if (id && value != null && value !== '') values[id] = value;
  };
  put('gift', { labels: [gift.name] });
  put('code', e.code);
  put('value', gift.value);
  put('claimed', { date: chicagoDay(e.created_at) });
  put('expires', { date: chicagoDay(e.expires_at) });
  put('zip', e.zip);
  put('campaign', e.utm?.utm_campaign);
  put('landing', e.context?.landing || e.page);
  put('smsConsent', { checked: e.sms_marketing ? 'true' : 'false' });
  const property = homeLine(e.home);
  if (property) put('property', { text: property });
  return values;
}

const utmText = (u: Entry['utm']) => (u && Object.keys(u).length ? Object.entries(u).map(([k, v]) => `${k.replace(/^utm_/, '')}=${v}`).join(' · ') : '');

/** The block the CSR reads (and pastes into Sera's customer note). */
export function pasteBlock(e: Entry, gift: Gift, cfg: Cfg) {
  const isMem = gift.id === cfg.membership.giftId;
  return [
    `COMFORT DIAL ${e.code} · won ${e.created_at}`,
    `Gift: ${gift.name} (${gift.sub})`,
    `Phone: ${fmtPhone(e.phone)}${e.first_name ? ` · ${e.first_name}` : ''}`,
    `Address: ${e.address ? `${e.address}, ${e.zip}${isMem ? ' (matched to county record; the free year is tied to this home)' : ''}` : 'not given yet'}`,
    `Expires: ${chicagoDate(e.expires_at)}`,
    e.voided_at ? `VOID: ${e.voided_note || 'cancelled in the admin'}. Do not honor this code.` : null,
    `Texts: code sent by Podium · reminders ${e.sms_marketing ? 'yes (Klaviyo)' : 'no'}`,
    `NEXT: when they call, check the phone matches, search the board for their street to make sure the home hasn't redeemed a dial code before, put the service address on this item, apply the gift in Sera, then set Code status to Redeemed.`,
    utmText(e.utm) ? `UTM: ${utmText(e.utm)}` : null,
    e.home ? `Home (county record): ${homeLine(e.home)}` : null,
    homeHints(e.home).length ? `Worth asking: ${homeHints(e.home).join('; ')}` : null,
    priorLine(e.prior) ? `Seen before: ${priorLine(e.prior)}` : null,
    visitLine(e.context) ? `Visit: ${visitLine(e.context)}` : null
  ].filter(Boolean).join('\n');
}

/* Two sets so a bad column can never lose the item: `core` goes in create_item and holds only columns that have been
 * on the board since day one; everything else is `details`, written by a second call that may fail on its own. */
export function mondayColumns(e: Entry, gift: Gift, cfg: Cfg, codeStatusColumn?: string, columns: DialColumns = {}) {
  const C = MONDAY_COLUMNS;
  const filled = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''));
  const core = filled({
    [C.phone]: { phone: e.phone, countryShortName: 'US' },
    [C.status]: { label: 'New' },
    [C.address]: e.address ? `${e.address}, ${e.zip}` : undefined
  });
  const details = filled({
    [C.quote]: { text: pasteBlock(e, gift, cfg) },
    [C.source]: Object.keys(columns).length ? e.utm?.utm_source || 'Comfort Dial' : ['Comfort Dial', utmText(e.utm)].filter(Boolean).join(' · '),
    ...structuredColumns(e, gift, columns),
    ...(codeStatusColumn ? { [codeStatusColumn]: { label: e.voided_at ? 'Void' : e.redeemed_at ? 'Redeemed' : 'Issued' } } : {})
  });
  return { core, details };
}

async function monday(env: unknown, query: string, variables: Record<string, unknown>) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: envVar(env, 'MONDAY_API_TOKEN')!, 'API-Version': '2024-10' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8000)
  });
  const j: any = await res.json();
  if (j.errors || j.error_message) throw new Error(JSON.stringify(j.errors || j.error_message).slice(0, 300));
  return j.data;
}

export async function createDialItem(env: unknown, e: Entry, gift: Gift, cfg: Cfg): Promise<{ itemId: string; detailsError?: string }> {
  const board = envVar(env, 'MONDAY_BOARD_ID');
  const columns = dialColumns(env);
  const { core, details } = mondayColumns(e, gift, cfg, envVar(env, 'MONDAY_CODE_STATUS_COLUMN'), columns);
  const created = await monday(env, 'mutation($b: ID!, $n: String!, $c: JSON!) { create_item(board_id: $b, item_name: $n, column_values: $c) { id } }',
    { b: board, n: itemName(e, gift, !!columns.code), c: JSON.stringify(core) });
  const itemId = String(created.create_item.id);
  try {
    await monday(env, 'mutation($b: ID!, $i: ID!, $c: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $c, create_labels_if_missing: true) { id } }',
      { b: board, i: itemId, c: JSON.stringify(details) });
    return { itemId };
  } catch (err) {
    // A detail column was renamed or deleted. The item exists; post the block as an update so the CSR still has it.
    await monday(env, 'mutation($i: ID!, $t: String!) { create_update(item_id: $i, body: $t) { id } }',
      { i: itemId, t: '<pre>' + pasteBlock(e, gift, cfg).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>' }).catch(() => {});
    return { itemId, detailsError: String(err) };
  }
}

/** After the optional "book faster" step: new name and address on the existing item. */
export async function updateDialItem(env: unknown, itemId: string, e: Entry, gift: Gift, cfg: Cfg) {
  const C = MONDAY_COLUMNS;
  const columns = dialColumns(env);
  const values: Record<string, unknown> = { name: itemName(e, gift, !!columns.code), [C.quote]: { text: pasteBlock(e, gift, cfg) }, ...structuredColumns(e, gift, columns) };
  if (e.address) values[C.address] = `${e.address}, ${e.zip}`;
  await monday(env, 'mutation($b: ID!, $i: ID!, $c: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $c, create_labels_if_missing: true) { id } }',
    { b: envVar(env, 'MONDAY_BOARD_ID'), i: itemId, c: JSON.stringify(values) });
}

/** After a change in the admin (redeem, void, restore, extend): Code status to match and the CSR's block redone.
 *  "Void" is a new label; Monday adds it to the column the first time. Setting Redeemed here fires the board's
 *  webhook back at /api/redeemed, which finds the code already redeemed and does nothing. */
export async function syncDialItem(env: unknown, itemId: string, e: Entry, gift: Gift, cfg: Cfg) {
  const col = envVar(env, 'MONDAY_CODE_STATUS_COLUMN');
  const values: Record<string, unknown> = { [MONDAY_COLUMNS.quote]: { text: pasteBlock(e, gift, cfg) }, ...structuredColumns(e, gift, dialColumns(env)) };
  if (col) values[col] = { label: e.voided_at ? 'Void' : e.redeemed_at ? 'Redeemed' : 'Issued' };
  await monday(env, 'mutation($b: ID!, $i: ID!, $c: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $c, create_labels_if_missing: true) { id } }',
    { b: envVar(env, 'MONDAY_BOARD_ID'), i: itemId, c: JSON.stringify(values) });
}

/** Earlier items on the leads board with this phone (Instant Pricing quotes, past dial wins). The phone column is
 *  matched on the forms numbers get stored in. Called before the winner's own item exists. */
export async function findLeadsByPhone(env: unknown, phone: string): Promise<Lead[]> {
  const C = MONDAY_COLUMNS;
  const data = await monday(env, `query($b: ID!, $c: String!, $v: [String]!) {
    items_page_by_column_values(limit: 10, board_id: $b, columns: [{ column_id: $c, column_values: $v }]) {
      items { id name created_at group { title } column_values(ids: ["${C.status}", "${C.source}", "${C.quote}"]) { id text } }
    } }`, { b: envVar(env, 'MONDAY_BOARD_ID'), c: C.phone, v: [phone, `1${phone}`, `+1${phone}`, fmtPhone(phone)] });
  const items: any[] = data?.items_page_by_column_values?.items || [];
  return items.map((it) => {
    const col = (id: string) => (it.column_values || []).find((c: any) => c.id === id)?.text || undefined;
    return {
      id: String(it.id), name: String(it.name || '').slice(0, 140), created: it.created_at, group: it.group?.title,
      status: col(C.status), source: col(C.source), notes: col(C.quote)?.slice(0, 400)
    };
  });
}

/** Monday's "When a column changes, send a webhook" integration. First call is a challenge to echo back.
 *  Returns the item id when the Code status column was set to Redeemed. */
export function parseRedeemedWebhook(body: any, codeStatusColumn: string | undefined): { challenge: string } | { itemId: string } | null {
  if (body && typeof body.challenge === 'string') return { challenge: body.challenge };
  const ev = body?.event;
  if (!ev || !codeStatusColumn || ev.columnId !== codeStatusColumn) return null;
  const label = ev.value?.label?.text;
  if (typeof label !== 'string' || label.trim().toLowerCase() !== 'redeemed') return null;
  const itemId = ev.pulseId ?? ev.itemId;
  return itemId != null ? { itemId: String(itemId) } : null;
}
