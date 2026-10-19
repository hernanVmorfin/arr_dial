/* The thermostat face, drawn the same way in the popup (index.js) and in the admin's live preview, so what an admin
 * sees before publishing is what visitors get. Gifts sit on a 50–90°F scale; each slice's arc is its share of the
 * odds. Pure DOM: the caller owns the <svg> and passes in its ring and face groups. */
import { labelFontSize, arcUnits, LABEL } from '../lib/rules.js';

export const NS = 'http://www.w3.org/2000/svg';
export const A0 = -135, A1 = 135, F0 = 50, F1 = 90, DPF = (A1 - A0) / (F1 - F0);
const Z_OUT = 146, Z_IN = 94, R_BIG = LABEL.big.radius, R_SMALL = LABEL.small.radius;
export const pt = (a, r) => { const t = a * Math.PI / 180; return [r * Math.sin(t), -r * Math.cos(t)]; };
export const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
export const angToF = (a) => F0 + (a - A0) / DPF;
export const fToAng = (f) => A0 + (f - F0) * DPF;
const arcPath = (a0, a1, r) => { const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r); return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`; };

/** Everything inside the dial's <svg viewBox="-172 -172 344 344">. `ids` prefixes the gradient ids. */
export const svgInner = (ids = 'arrd') => `
      <defs>
        <linearGradient id="${ids}-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f9f7f8"/><stop offset=".38" stop-color="#c9d4e2"/><stop offset=".55" stop-color="#f9f7f8"/><stop offset="1" stop-color="#a9bcd6"/></linearGradient>
        <radialGradient id="${ids}-face" cx="50%" cy="38%" r="65%"><stop offset="0" stop-color="#1b3050"/><stop offset="1" stop-color="#0f1f3d"/></radialGradient>
      </defs>
      <g data-arrd="ring"></g>
      <circle r="151" fill="url(#${ids}-face)" stroke="#0b1830" stroke-width="3"/>
      <g data-arrd="face"></g>
      <text x="-46" y="124" text-anchor="middle" fill="#03bce6" font-family="Oswald, sans-serif" font-weight="600" font-size="11" letter-spacing="2">COOL</text>
      <text x="46" y="124" text-anchor="middle" fill="#ee292f" font-family="Oswald, sans-serif" font-weight="600" font-size="11" letter-spacing="2">HEAT</text>
      <text y="141" text-anchor="middle" fill="#a9bcd6" font-family="Oswald, sans-serif" font-size="8.5" letter-spacing="1.6">ARR · SINCE 1935</text>
      <circle r="66" fill="#0b1830" stroke="#f9f7f8" stroke-opacity=".14" stroke-width="2"/>
      <text data-arrd="hubLabel" y="-25" text-anchor="middle" fill="#a9bcd6" font-family="Oswald, sans-serif" font-size="10" letter-spacing="1.8">SET TO</text>
      <text data-arrd="hubMain" y="11" text-anchor="middle" fill="#f9f7f8" font-family="Archivo, Arial Black, sans-serif" font-weight="900" font-size="33" style="font-stretch:125%">68°</text>
      <text data-arrd="hubSub" y="33" text-anchor="middle" fill="#ffcc04" font-family="Oswald, sans-serif" font-weight="600" font-size="10.5" letter-spacing=".8">TAP TO TURN</text>
      <g data-arrd="marker">
        <line x1="0" y1="-69" x2="0" y2="-90" stroke="#f9f7f8" stroke-width="7" stroke-linecap="round"/>
        <line x1="0" y1="-69" x2="0" y2="-90" stroke="#ee292f" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M -9 -170 L 9 -170 L 0 -152 Z" fill="#ee292f" stroke="#14284e" stroke-width="1.5" stroke-linejoin="round"/>
      </g>`;

export function buildRing(ring, ids = 'arrd') {
  ring.appendChild(el('circle', { r: 168, fill: `url(#${ids}-metal)`, stroke: '#a9bcd6', 'stroke-width': 1 }));
  for (let i = 0; i < 120; i++) {
    const [x1, y1] = pt(i * 3, 157), [x2, y2] = pt(i * 3, 166);
    ring.appendChild(el('line', { x1, y1, x2, y2, stroke: '#5c6672', 'stroke-opacity': 0.45, 'stroke-width': 1.2 }));
  }
}

function label(defs, face, id, a0, a1, r, text, attrs) {
  defs.appendChild(el('path', { id, d: arcPath(a0, a1, r), fill: 'none' }));
  const t = el('text', { 'font-family': 'Oswald, Arial Narrow, sans-serif', 'dominant-baseline': 'central', ...attrs });
  const tp = el('textPath', { href: `#${id}`, startOffset: '50%', 'text-anchor': 'middle' });
  tp.textContent = text; t.appendChild(tp); face.appendChild(t);
}

/** Draws the slices, labels and scale into `face`. A slice for `closedId` (this month's free year, once taken) shows
 *  GONE / TAKEN. Returns the slices with their angles, for landing the needle. */
export function drawFace(face, zones, giftsById, closedId = null, ids = 'arrd') {
  face.innerHTML = '';
  const segs = [];
  const defs = el('defs', {}); face.appendChild(defs);
  let a = A0;
  zones.forEach((z, i) => {
    const gift = giftsById[z.gift];
    if (!gift) return;
    const span = z.pct / 100 * (A1 - A0), a0 = a, a1 = a + span; a = a1;
    segs.push({ gift, a0, a1 });
    const closed = gift.id === closedId;
    const [x0, y0] = pt(a0, Z_OUT), [x1, y1] = pt(a1, Z_OUT), [x2, y2] = pt(a1, Z_IN), [x3, y3] = pt(a0, Z_IN), lg = span > 180 ? 1 : 0;
    face.appendChild(el('path', { d: `M${x0} ${y0} A${Z_OUT} ${Z_OUT} 0 ${lg} 1 ${x1} ${y1} L${x2} ${y2} A${Z_IN} ${Z_IN} 0 ${lg} 0 ${x3} ${y3}Z`, fill: closed ? '#2b3f63' : gift.fill, stroke: '#0f1f3d', 'stroke-width': 2 }));
    const ink = closed ? '#a9bcd6' : gift.ink, big = closed ? 'GONE' : z.big, small = closed ? 'TAKEN' : z.small;
    label(defs, face, `${ids}-zb${i}`, a0, a1, R_BIG, big, { fill: ink, 'font-weight': 600, 'font-size': labelFontSize(big, arcUnits(z.pct, R_BIG), LABEL.big.max).toFixed(1), 'letter-spacing': '.3' });
    label(defs, face, `${ids}-zs${i}`, a0, a1, R_SMALL, small, { fill: ink, 'font-weight': 500, 'font-size': labelFontSize(small, arcUnits(z.pct, R_SMALL), LABEL.small.max).toFixed(1), 'letter-spacing': '.5', opacity: 0.92 });
  });
  for (let f = F0; f <= F1; f += 5) {
    const a2 = fToAng(f), major = f % 10 === 0;
    const [x1, y1] = pt(a2, 86), [x2, y2] = pt(a2, 91);
    face.appendChild(el('line', { x1, y1, x2, y2, stroke: '#f9f7f8', 'stroke-opacity': major ? 0.8 : 0.35, 'stroke-width': major ? 2 : 1.2 }));
    if (major) {
      const [tx, ty] = pt(a2, 78);
      const n = el('text', { x: tx, y: ty, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: f === 70 ? '#f9f7f8' : '#a9bcd6', 'font-family': 'Inter, sans-serif', 'font-weight': 600, 'font-size': 9.5 });
      n.textContent = f; face.appendChild(n);
    }
  }
  return segs;
}
