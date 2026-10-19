/* Results: what the dial did in a period. Tiles for the headline numbers, a daily chart (turns, codes claimed,
 * codes redeemed: one count axis), each promo's real share of turns against its odds, and where winners came from.
 * Chart colours are ARR's (the Bible's series order, lighter steps on dark); the daily chart has a legend, a tooltip
 * per day and a table view, because light blue on white is low contrast. */
import { api, esc, $, fmtNum, fmtMoney, fmtPct, fmtDate } from './ui.js';

const RANGES = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['all', 'All time']];
const SERIES = [['turns', 'Turns', '--s1'], ['claims', 'Codes claimed', '--s2'], ['redeemed', 'Redeemed', '--s3']];
const sel = { range: '7d', from: '', to: '' };
let root = null, seq = 0, tableView = false;

export function render(main) {
  root = main;
  main.innerHTML = `
    <div class="head"><div>
      <p class="eyebrow">How it's doing</p><h1>Results</h1>
      <p class="muted">Turns, codes and redemptions, by Chicago day. Popup views and the 50/50 control group are tracked in Google Tag Manager, not here.</p>
    </div>
    <div class="ranges" role="group" aria-label="Period">
      ${RANGES.map(([k, l]) => `<button type="button" data-r="${k}" aria-pressed="${!sel.from && sel.range === k}">${l}</button>`).join('')}
      <input type="date" id="rf" aria-label="From" value="${esc(sel.from)}"><span class="muted">to</span><input type="date" id="rt" aria-label="To" value="${esc(sel.to)}">
    </div></div>
    <div id="res"><p class="muted">Loading…</p></div>`;
  $('.ranges', main).addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    sel.range = b.dataset.r; sel.from = ''; sel.to = ''; $('#rf', main).value = ''; $('#rt', main).value = '';
    main.querySelectorAll('[data-r]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load();
  });
  const custom = () => {
    const a = $('#rf', main).value, b = $('#rt', main).value;
    if (!a || !b || a > b) return;
    sel.from = a; sel.to = b; main.querySelectorAll('[data-r]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    load();
  };
  $('#rf', main).addEventListener('change', custom);
  $('#rt', main).addEventListener('change', custom);
  load();
}
export function destroy() { root = null; }

async function load() {
  const mine = ++seq;
  const q = sel.from ? `from=${sel.from}&to=${sel.to}` : `range=${sel.range}`;
  const r = await api(`stats?${q}`);
  if (mine !== seq || !root) return;
  const box = $('#res', root);
  if (!r.ok) { box.innerHTML = `<p class="err">${esc(r.error)}</p>`; return; }
  draw(box, r);
}

function draw(box, r) {
  const s = r.stats, gifts = Object.fromEntries(r.gifts.map((g) => [g.id, g]));
  const value = (key) => s.byGift.reduce((sum, x) => sum + x[key] * (gifts[x.gift]?.value || 0), 0);
  const rate = (a, b) => (b ? (a / b) * 100 : null);
  const tile = (label, v, d, cls = '') => `<div class="kpi ${cls}"><div class="label">${label}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  const span = r.from === r.to ? fmtDate(`${r.from}T12:00:00Z`) : `${fmtDate(`${r.from}T12:00:00Z`)} – ${fmtDate(`${r.to}T12:00:00Z`)}`;
  box.innerHTML = `
    <p class="small muted" style="margin:0 0 10px">${esc(span)}${s.versions.length > 1 ? ` · the odds changed during this period (versions ${s.versions.join(', ')})` : ''}</p>
    <div class="kpis">
      ${tile('Turns', fmtNum(s.turns), `${fmtNum(s.players)} ${s.players === 1 ? 'person' : 'people'}`)}
      ${tile('Codes claimed', fmtNum(s.claims), `${fmtPct(rate(s.claims, s.players))} of people who turned`, 'red')}
      ${tile('Redeemed', fmtNum(s.redeemed), `${fmtPct(rate(s.redeemed, s.claims))} of codes claimed`, 'cool')}
      ${tile('Value claimed', fmtMoney(value('claims')), `${fmtMoney(value('redeemed'))} of it redeemed`)}
      ${tile('Reminder opt-ins', fmtNum(s.reminders), `${fmtPct(rate(s.reminders, s.claims))} of winners`)}
      ${s.voided ? tile('Voided', fmtNum(s.voided), 'cancelled in the admin', 'red') : ''}
    </div>
    <section class="card">
      <div class="head" style="margin-bottom:6px"><h2>By day</h2><button type="button" class="linkbtn small" id="tv">${tableView ? 'Show the chart' : 'Show as a table'}</button></div>
      <div id="daily"></div>
    </section>
    <div class="grid2" style="margin-top:14px">
      <section class="card"><h2>Odds vs. what happened</h2><div id="share"></div></section>
      <section class="card"><h2>Where winners came from</h2><div id="src"></div></section>
    </div>`;
  const days = fillDays(s.byDay, r.from, r.to, !sel.from && sel.range === 'all');
  const paintDaily = () => { const el = $('#daily', box); el.innerHTML = tableView ? dailyTable(days) : dailyChart(days, el.clientWidth); if (!tableView) wireTips(el, days); };
  paintDaily();
  $('#tv', box).addEventListener('click', (e) => { tableView = !tableView; e.target.textContent = tableView ? 'Show the chart' : 'Show as a table'; paintDaily(); });
  $('#share', box).innerHTML = share(s, r);
  $('#src', box).innerHTML = sources(s);
}

/* Every day in the period, zeros included, so gaps show as gaps. 'All time' starts at the first day with data. */
function fillDays(byDay, from, to, trim) {
  const have = Object.fromEntries(byDay.map((d) => [d.day, d]));
  const first = trim && byDay.length && byDay[0].day > from ? byDay[0].day : from;
  const out = [];
  for (let d = first; d <= to && out.length < 400; d = new Date(Date.parse(`${d}T12:00:00Z`) + 864e5).toISOString().slice(0, 10)) {
    out.push(have[d] || { day: d, turns: 0, claims: 0, redeemed: 0 });
  }
  return out;
}

const dayLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function niceMax(v) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/* Drawn at the container's width in CSS pixels, so the text stays 11px and the plot stays 240px tall. */
function dailyChart(days, width) {
  const total = days.reduce((s, d) => s + d.turns + d.claims + d.redeemed, 0);
  const legend = `<div class="legend">${SERIES.map(([, l, c]) => `<span><i style="background:var(${c})"></i>${l}</span>`).join('')}</div>`;
  if (!total) return `${legend}<div class="empty">Nothing in this period yet.</div>`;
  const W = Math.max(300, Math.round(width || 760)), H = 240, L = 40, R = 8, T = 10, B = 26;
  const max = niceMax(Math.max(...days.map((d) => Math.max(d.turns, d.claims, d.redeemed))));
  const slot = (W - L - R) / days.length, gap = 2;
  const bw = Math.max(1.5, Math.min(14, (slot - 6) / 3 - gap));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const every = Math.ceil(days.length / Math.max(2, Math.floor((W - L) / 64)));
  let svg = ticks.map((t) => `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmtNum(t)}</text>`).join('');
  days.forEach((d, i) => {
    const cx = L + slot * i + slot / 2, x0 = cx - (bw * 3 + gap * 2) / 2;
    SERIES.forEach(([k, , c], j) => {
      const v = d[k]; if (!v) return;
      const x = x0 + j * (bw + gap), top = y(v), h = y(0) - top, rr = Math.min(4, bw / 2, h);
      svg += `<path d="M${x} ${y(0)}V${top + rr}Q${x} ${top} ${x + rr} ${top}H${x + bw - rr}Q${x + bw} ${top} ${x + bw} ${top + rr}V${y(0)}Z" style="fill:var(${c})"/>`;
    });
    if (i % every === 0) svg += `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(dayLabel(d.day))}</text>`;
    svg += `<rect data-d="${i}" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent"/>`;
  });
  return `${legend}<div class="chart"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Turns, codes claimed and codes redeemed per day">${svg}</svg><div class="tip" hidden></div></div>`;
}

function wireTips(box, days) {
  const chart = $('.chart', box); if (!chart) return;
  const tip = $('.tip', chart), svg = $('svg', chart);
  const show = (rect) => {
    const d = days[Number(rect.dataset.d)];
    tip.innerHTML = `<b>${esc(dayLabel(d.day))}</b><br>${SERIES.map(([k, l]) => `${l}: <b>${fmtNum(d[k])}</b>`).join('<br>')}`;
    tip.hidden = false;
    const b = rect.getBoundingClientRect(), c = chart.getBoundingClientRect();
    const left = Math.min(Math.max(0, b.left - c.left + b.width / 2 - tip.offsetWidth / 2), c.width - tip.offsetWidth);
    tip.style.left = `${left}px`; tip.style.top = '0px';
  };
  svg.addEventListener('pointermove', (e) => { const r = e.target.closest('[data-d]'); if (r) show(r); });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });
}

function dailyTable(days) {
  const rows = days.filter((d) => d.turns || d.claims || d.redeemed).reverse();
  if (!rows.length) return '<div class="empty">Nothing in this period yet.</div>';
  return `<div class="tablewrap"><table><thead><tr><th>Day</th>${SERIES.map(([, l]) => `<th class="num">${l}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((d) => `<tr><td>${esc(dayLabel(d.day))}</td>${SERIES.map(([k]) => `<td class="num">${fmtNum(d[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* Each promo's share of turns (bar) against its odds now (tick). */
function share(s, r) {
  if (!s.turns) return '<div class="empty">No turns in this period yet.</div>';
  const by = Object.fromEntries(s.byGift.map((x) => [x.gift, x]));
  const rows = r.gifts.filter((g) => g.active || by[g.id]);
  const max = Math.max(...rows.map((g) => Math.max(g.odds || 0, ((by[g.id]?.turns || 0) / s.turns) * 100)), 1);
  const scale = (v) => `${(v / max) * 100}%`;
  return `<p class="small muted" style="margin:-4px 0 8px">Bar: share of turns that landed on it. Tick: its odds now. Small samples wander; the free year also leaves play once a month is claimed, which lifts the others a little.${s.turns < 200 ? ` <b>Only ${fmtNum(s.turns)} turns so far.</b>` : ''}</p>` +
    rows.map((g) => {
      const t = by[g.id]?.turns || 0, actual = (t / s.turns) * 100;
      return `<div class="bullet"><span style="display:flex;gap:8px;align-items:center;min-width:0"><i class="swatch" style="background:${esc(g.fill)}"></i><span>${esc(g.name)}${g.active ? '' : ' <span class="tag off">off</span>'}</span></span>
        <div class="track" role="img" aria-label="${esc(g.name)}: ${fmtPct(actual)} of turns, odds ${fmtPct(g.odds)}"><div class="fill" style="width:${scale(actual)}"></div>${g.active ? `<div class="mark" style="left:${scale(g.odds)}"></div>` : ''}</div>
        <span class="nums small"><b>${fmtPct(actual)}</b> · odds ${g.active ? fmtPct(g.odds) : '–'}<br><span class="muted">${fmtNum(t)} turns · ${fmtNum(by[g.id]?.claims || 0)} codes</span></span></div>`;
    }).join('');
}

function sources(s) {
  if (!s.sources.length) return '<div class="empty">No codes claimed in this period yet.</div>';
  return `<div class="tablewrap"><table><thead><tr><th>Source (utm_source)</th><th class="num">Codes</th><th class="num">Redeemed</th><th class="num">Rate</th></tr></thead>
    <tbody>${s.sources.map((x) => `<tr><td>${esc(x.source)}</td><td class="num">${fmtNum(x.claims)}</td><td class="num">${fmtNum(x.redeemed)}</td><td class="num">${fmtPct(x.claims ? (x.redeemed / x.claims) * 100 : null)}</td></tr>`).join('')}</tbody></table></div>`;
}
