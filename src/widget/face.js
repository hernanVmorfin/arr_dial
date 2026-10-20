/* The thermostat screen's dial, drawn the same way in the popup (index.js) and in the admin's live preview, so what an
 * admin sees before publishing is what visitors get. Gifts sit on a 50–90°F ring; each slice's angle is its share of
 * the odds. The top prize (this month's free year, while it's open) sits raised with a gold glow and a TOP PRIZE tag:
 * deeper, never wider. Pure DOM on a 400-wide face (VIEWBOX), the ring centred at CX,CY: the caller owns the <svg>
 * and fills it with svgInner(), then draws into its face and tag groups. */
import { labelFontSize, arcUnits, RING, LABEL, labelRadii } from '../lib/rules.js';

export const NS = 'http://www.w3.org/2000/svg';
export const VIEWBOX = '0 0 400 400';
export const A0 = -135, A1 = 135, F0 = 50, F1 = 90, DPF = (A1 - A0) / (F1 - F0), CX = 200, CY = 196;
export const pt = (a, r) => { const t = a * Math.PI / 180; return [r * Math.sin(t), -r * Math.cos(t)]; };
export const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
export const angToF = (a) => F0 + (a - A0) / DPF;
export const fToAng = (f) => A0 + (f - F0) * DPF;
const arcPath = (a0, a1, r) => { const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r); return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
const segPath = (a0, a1, ro, ri) => { const [x0, y0] = pt(a0, ro), [x1, y1] = pt(a1, ro), [x2, y2] = pt(a1, ri), [x3, y3] = pt(a0, ri), lg = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0}A${ro} ${ro} 0 ${lg} 1 ${x1} ${y1}L${x2} ${y2}A${ri} ${ri} 0 ${lg} 0 ${x3} ${y3}Z`; };

/** Everything inside the dial's <svg viewBox="0 0 400 400">: the black glass, the red heating and blue cooling glows
 *  (hidden until the popup's CSS shows one), the ring, the needle, the white readout disc and the tag. `ids` prefixes the defs' ids. */
export const svgInner = (ids = 'arrd') => `
      <defs>
        <radialGradient id="${ids}-heat" cx="50%" cy="49%" r="54%"><stop offset="0" stop-color="#ee292f" stop-opacity=".42"/><stop offset=".6" stop-color="#ee292f" stop-opacity=".12"/><stop offset="1" stop-color="#ee292f" stop-opacity="0"/></radialGradient>
        <radialGradient id="${ids}-cool" cx="50%" cy="49%" r="54%"><stop offset="0" stop-color="#03bce6" stop-opacity=".42"/><stop offset=".6" stop-color="#03bce6" stop-opacity=".12"/><stop offset="1" stop-color="#03bce6" stop-opacity="0"/></radialGradient>
        <filter id="${ids}-gold" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>
      </defs>
      <rect width="400" height="400" rx="86" fill="#221f20"/>
      <rect class="arrd-heat" width="400" height="400" fill="url(#${ids}-heat)" opacity="0"/>
      <rect class="arrd-cool" width="400" height="400" fill="url(#${ids}-cool)" opacity="0"/>
      <g transform="translate(${CX} ${CY})">
        <g data-arrd="face"></g>
        <g data-arrd="marker">
          <line x1="0" y1="${-RING.inner + 4}" x2="0" y2="${-RING.outer - 6}" stroke="#221f20" stroke-width="8" stroke-linecap="round"/>
          <line x1="0" y1="${-RING.inner + 4}" x2="0" y2="${-RING.outer - 6}" stroke="#f9f7f8" stroke-width="4" stroke-linecap="round"/>
        </g>
        <circle r="60" fill="#f9f7f8"/>
        <text data-arrd="hubLabel" y="-24" text-anchor="middle" fill="#5c6672" font-family="Oswald, Arial Narrow, sans-serif" font-weight="600" font-size="10.3" letter-spacing="1.8">SET TO</text>
        <text data-arrd="hubMain" y="13" text-anchor="middle" fill="#14284e" font-family="Archivo, Arial Black, sans-serif" font-weight="900" font-size="36" style="font-stretch:112%">68°</text>
        <text data-arrd="hubSub" y="35" text-anchor="middle" fill="#ee292f" font-family="Oswald, Arial Narrow, sans-serif" font-weight="600" font-size="12.5" letter-spacing="1">TAP TO TURN</text>
      </g>
      <g data-arrd="tag"></g>`;

/** Font size for a line in the readout disc: as large as `max`, shrunk to fit its ~108-unit width. */
export const hubSize = (text, max = 12.5) => Math.min(max, 108 / (Math.max(String(text).length, 1) * 0.52));

function label(defs, g, id, a0, a1, r, text, attrs) {
  defs.appendChild(el('path', { id, d: arcPath(a0, a1, r), fill: 'none' }));
  const t = el('text', { 'font-family': 'Oswald, Arial Narrow, sans-serif', 'dominant-baseline': 'central', ...attrs });
  const tp = el('textPath', { href: `#${id}`, startOffset: '50%', 'text-anchor': 'middle' });
  tp.textContent = text; t.appendChild(tp); g.appendChild(t);
}

/** Draws the slices, labels and scale into `face`, and the TOP PRIZE tag into `tag` (when given). A slice for
 *  `closedId` (this month's free year, once taken) shows GONE / TAKEN; one for `topId` sits raised. Returns the
 *  slices with their angles and groups, for landing the needle and lighting the slice under it. */
export function drawFace(face, zones, giftsById, { closedId = null, topId = null, ids = 'arrd', tag = null } = {}) {
  face.innerHTML = '';
  const segs = [];
  const defs = el('defs', {}); face.appendChild(defs);
  let a = A0;
  zones.forEach((z, i) => {
    const gift = giftsById[z.gift];
    if (!gift) return;
    const span = z.pct / 100 * (A1 - A0), a0 = a, a1 = a + span; a = a1;
    const closed = gift.id === closedId, top = !closed && gift.id === topId;
    const ro = top ? RING.outer + RING.raise : RING.outer, ri = RING.inner, r = labelRadii(ro);
    const g = el('g', { class: 'arrd-z' }); face.appendChild(g);
    segs.push({ gift, a0, a1, g });
    if (top) g.appendChild(el('path', { d: segPath(a0 - 1, a1 + 1, ro + 3, ri - 2), fill: '#ffcc04', opacity: 0.7, filter: `url(#${ids}-gold)` }));
    g.appendChild(el('path', { d: segPath(a0 + 0.8, a1 - 0.8, ro, ri), fill: closed ? '#5c6672' : gift.fill }));
    const ink = closed ? '#dee5ee' : gift.ink, big = closed ? 'GONE' : z.big, small = closed ? 'TAKEN' : z.small;
    label(defs, g, `${ids}-zb${i}`, a0, a1, r.big, big, { fill: ink, 'font-weight': 600, 'font-size': labelFontSize(big, arcUnits(z.pct, r.big), LABEL.big.max).toFixed(1), 'letter-spacing': '.3' });
    label(defs, g, `${ids}-zs${i}`, a0, a1, r.small, small, { fill: ink, 'font-weight': 500, 'font-size': labelFontSize(small, arcUnits(z.pct, r.small), LABEL.small.max).toFixed(1), 'letter-spacing': '.4', opacity: 0.9 });
  });
  for (let f = F0; f <= F1; f += 2.5) {
    const major = f % 10 === 0, [x1, y1] = pt(fToAng(f), RING.inner - 9), [x2, y2] = pt(fToAng(f), RING.inner - (major ? 3 : 5));
    face.appendChild(el('line', { x1, y1, x2, y2, stroke: '#f9f7f8', 'stroke-opacity': major ? 0.65 : 0.28, 'stroke-width': major ? 1.8 : 1.1, 'stroke-linecap': 'round' }));
  }
  if (tag) drawTag(tag, segs, topId);
  return segs;
}

/** The TOP PRIZE tag in the top corner, pointing at the first slice of `topId`. Empty when there's no top prize. */
export function drawTag(tag, segs, topId) {
  tag.innerHTML = '';
  const s = topId && segs.find((x) => x.gift.id === topId);
  if (!s) return;
  const mid = (s.a0 + s.a1) / 2, [x, y] = pt(mid, RING.outer + RING.raise + 3), right = mid >= 0, bx = right ? 276 : 24;
  tag.appendChild(el('line', { x1: CX + x, y1: CY + y, x2: right ? bx : bx + 100, y2: 64, stroke: '#ffcc04', 'stroke-width': 1.5 }));
  tag.appendChild(el('rect', { x: bx, y: 46, width: 100, height: 40, rx: 12, fill: '#ffcc04' }));
  const line = (ty, text, size, ls) => { const n = el('text', { x: bx + 50, y: ty, 'text-anchor': 'middle', fill: '#14284e', 'font-family': 'Oswald, Arial Narrow, sans-serif', 'font-weight': 600, 'font-size': size, 'letter-spacing': ls }); n.textContent = text; tag.appendChild(n); };
  line(61, '★ TOP PRIZE', 9.5, 1.2);
  line(79, s.gift.short, Math.min(13, 92 / (String(s.gift.short).length * 0.5)), 0.4);
}
