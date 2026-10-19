/* Comfort Dial: the gift popup for alwaysreadyrepair.com. Builds to <base>/dial.js (astro.config.mjs) and drops into
 * Webflow site-wide custom code with:
 *   <script type="module" src="/dial/dial.js"></script>
 *
 * Gifts, odds, the dial layout and when it opens by itself all come from /api/status: the live config published in
 * the admin (<base>admin). data/dial.json is bundled only as the fallback drawn before that answer arrives.
 *
 * A round wall thermostat: gifts sit on a 50–90°F scale, arc length = the real odds, the free year at 72°.
 * Turn first, claim second: one tap turns the dial (/api/turn picks the gift, never this file, and holds it for
 * 10 minutes), then a mobile number claims it (/api/claim). A free-year winner also gives a home address.
 *
 * Opens by itself delayMs after the page shows on a first visit, for visitors in the dial share of the test (split),
 * on any page not in excludePaths. Never on top of the pricing popup, never after a win, not again for snoozeDays
 * after it was seen, never while the dial is paused in the admin. ?dial=1 in the URL, [data-arr-dial="open"] clicks
 * and window.ARRDial.open() always open it.
 * Those settings are the admin's. window.__ARR_DIAL__ can still set them, but the admin's win once /api/status
 * answers; `force: {...}` in it wins over the admin (the QA page uses that).
 * Vanilla JS, every class prefixed arrd- and every rule under .arrd-root, because it lives on someone else's page. */
import BUILT_IN from '../../data/dial.json';
import { svgInner, buildRing as drawRing, drawFace, angToF, fToAng, A0, A1 } from './face.js';
import { adParams, pathOf, referrerOf, cookieOf, gaClientId, klaviyoExchangeId, deviceKind, UTM_KEYS } from '../lib/visit.js';

const EMBED = window.__ARR_DIAL__ || {};
const CFG = Object.assign({
  apiBase: null,
  ...BUILT_IN.popup,     // split (share of visitors who get the popup; 1 = everyone, 0 = no one), delayMs, snoozeDays, excludePaths, tab
  logoUrl: 'https://cdn.prod.website-files.com/67706112234589f93fe7a263/6770706cd327b7c71e895d05_Main%20Logo.svg',
  debug: false
}, EMBED, EMBED.force || {});

const API = CFG.apiBase ? new URL(String(CFG.apiBase).replace(/\/?$/, '/'), location.href).href : new URL(/* @vite-ignore */ 'api/', import.meta.url).href;
const RULES_URL = new URL('../rules', API).href;
const STORE = 'arr-dial';

/* The live config. Starts as the bundled fallback; applyDial() swaps in the admin's when /api/status answers. */
let DIAL = { ...BUILT_IN, gifts: BUILT_IN.gifts.filter((g) => g.active !== false) };
let GIFTS = {}, MEM = '', TEL = '';
const index = () => { GIFTS = Object.fromEntries(DIAL.gifts.map((g) => [g.id, g])); MEM = DIAL.membership.giftId; TEL = DIAL.phone.replace(/\D/g, ''); };
index();
function applyDial(d) {
  if (!d || !Array.isArray(d.gifts) || !Array.isArray(d.zones)) return;
  DIAL = { ...DIAL, phone: d.phone, bookUrl: d.bookUrl, expiresDays: d.expiresDays, holdMinutes: d.holdMinutes, gifts: d.gifts, zones: d.zones, membership: { ...DIAL.membership, giftId: d.membershipGiftId } };
  index();
  if (d.popup) Object.assign(CFG, d.popup, EMBED.force || {});
  if (root) {
    buildFace(); renderOdds();
    root.querySelectorAll('[data-arrd="call"]').forEach((a) => { a.href = `tel:${TEL}`; if (/^Call\b/.test(a.textContent) && a.textContent !== 'Call to book') a.textContent = `Call ${DIAL.phone}`; });
  }
}

/* ---------------- state that outlives the page: the device id, test group, a held gift, a win ---------------- */
const store = {
  get() { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { return {}; } },
  set(patch) { try { localStorage.setItem(STORE, JSON.stringify({ ...store.get(), ...patch })); } catch (e) {} }
};
const uuid = () => { try { return crypto.randomUUID(); } catch (e) { return 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36); } };
const saved = store.get();
const device = saved.device || uuid();
/* Each browser keeps one roll in [0,1) and is in the dial group while roll < split, so moving the split in the admin
 * only moves the visitors between the old and new split. A browser grouped before rolls were kept gets one that
 * matches its group. */
const roll = typeof saved.roll === 'number' ? saved.roll
  : saved.variant === 'dial' ? Math.random() * 0.5 : saved.variant === 'control' ? 0.5 + Math.random() * 0.5 : Math.random();
let variant = null;
function assign() {
  variant = CFG.split >= 1 ? 'dial' : CFG.split <= 0 ? 'control' : roll < CFG.split ? 'dial' : 'control';
  store.set({ variant });
}
store.set({ device, roll });
assign();   // from the bundled settings for now; again once /api/status brings the admin's

/* ---------------- tracking: GTM dataLayer (dial_variant rides on every event for the 50/50 read) ---------------- */
/* ---------------- the visit: kept as they browse, sent with a turn (lib/visit.js), never shown back ----------------
 * first touch (this browser, kept): when, landing page, outside referrer, ad tags · visits so far ·
 * this visit (sessionStorage): landing page, referrer, ad tags, the last 15 pages, how long they've been here.
 * Paths only; a query string is kept only for its utm_* tags and ad click ids. */
const VISIT = 'arr-dial-visit';
const here = pathOf(location.href), hereAds = adParams(location.search), hereRef = referrerOf(document.referrer, location.hostname);
let session = null;
try { session = JSON.parse(sessionStorage.getItem(VISIT) || 'null'); } catch (e) {}
const first = saved.first || { at: new Date().toISOString(), landing: here, referrer: hereRef, ads: hereAds };
const visits = (saved.visits || 0) + (session ? 0 : 1);
if (!session) session = { start: Date.now(), landing: here, referrer: hereRef, ads: hereAds, pages: [], views: 0 };
else if (hereAds) session.ads = { ...(session.ads || {}), ...hereAds };   // a tagged link mid-visit
if (session.pages[session.pages.length - 1] !== here) session.pages = [...session.pages, here].slice(-15);
session.views = (session.views || 0) + 1;
try { sessionStorage.setItem(VISIT, JSON.stringify(session)); } catch (e) {}
store.set({ first, visits });

/* Last touch wins for the code's utm: this page's tags, else this visit's, else the first visit's. */
const UTM = {};
for (const src of [first.ads, session.ads, hereAds]) for (const k of [...UTM_KEYS, 'gclid', 'fbclid']) if (src && src[k]) UTM[k] = src[k];

function visitContext() {
  const c = document.cookie, ads = session.ads || {}, firstAds = first.ads || {};
  const fbclid = ads.fbclid || firstAds.fbclid;
  return {
    firstSeen: first.at, visits, firstLanding: first.landing, firstReferrer: first.referrer, firstAds: first.ads,
    landing: session.landing, referrer: session.referrer, ads: session.ads, pages: session.pages, pageViews: session.views, page: here,
    secondsOnSite: Math.round((Date.now() - session.start) / 1000),
    device: deviceKind(innerWidth, 'ontouchstart' in window || navigator.maxTouchPoints > 0),
    screen: `${screen.width}x${screen.height}`, lang: navigator.language,
    tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return undefined; } })(),
    ids: {
      ga: gaClientId(c), fbp: cookieOf(c, '_fbp'),
      fbc: cookieOf(c, '_fbc') || (fbclid ? `fb.1.${session.start}.${fbclid}` : null),
      kx: ads._kx || firstAds._kx || klaviyoExchangeId(c)
    }
  };
}
function track(ev, params = {}) {
  try { (window.dataLayer = window.dataLayer || []).push({ event: ev, dial_variant: variant, ...params }); } catch (e) {}
  if (ev === 'dial_claimed') { try { if (typeof fbq === 'function') fbq('track', 'Lead', { content_name: 'Comfort Dial', content_category: params.gift }); } catch (e) {} }
  if (CFG.debug) { try { console.log('[dial]', ev, params); } catch (e) {} }
}

/* ---------------- styles ---------------- */
const CSS = `
html.arrd-open{overflow:hidden}
html.arrd-open iframe[id^="podium"],html.arrd-open #podium-website-widget{visibility:hidden!important}
.arrd-root,.arrd-tab{--blue:#084e91;--red:#ee292f;--lb:#03bce6;--white:#f9f7f8;--black:#221f20;--navy:#14284e;--gray:#dee5ee;--yellow:#ffcc04;--muted:#a9bcd6;--line:#2e4a72;
  --head:"Archivo","Helvetica Neue",Arial,sans-serif;--sub:"Oswald","Barlow Condensed","Arial Narrow",sans-serif;--body:"Inter",-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.arrd-root,.arrd-root *,.arrd-tab{box-sizing:border-box}
.arrd-root[hidden],.arrd-root [hidden],.arrd-tab[hidden]{display:none!important}
.arrd-root{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(20,40,78,.55);font-family:var(--body);color:var(--white);line-height:1.5;-webkit-font-smoothing:antialiased;text-align:left}
.arrd-sheet{position:relative;width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow-y:auto;overscroll-behavior:contain;background:var(--navy);border-radius:18px;box-shadow:0 24px 70px -20px rgba(0,0,0,.6);padding:14px 24px 22px;animation:arrd-in .3s ease-out}
@keyframes arrd-in{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
@keyframes arrd-up{from{transform:translateY(100%)}to{transform:none}}
@media (max-width:640px){
  .arrd-root{align-items:flex-end;padding:0}
  .arrd-sheet{max-width:none;border-radius:18px 18px 0 0;max-height:92vh;padding:12px 18px calc(18px + env(safe-area-inset-bottom,0px));animation:arrd-up .32s cubic-bezier(.2,.8,.2,1)}
}
.arrd-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}
.arrd-logo{height:34px;width:auto;display:block;max-width:60%}
.arrd-x{width:40px;height:40px;border-radius:50%;border:1px solid rgba(249,247,248,.28);background:transparent;color:var(--white);font:400 24px/1 var(--body);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;flex:none}
.arrd-root button:focus-visible,.arrd-root a:focus-visible,.arrd-root input:focus-visible,.arrd-tab:focus-visible{outline:3px solid var(--yellow);outline-offset:3px}
.arrd-sec{display:flex;flex-direction:column;align-items:stretch;gap:10px;margin-top:4px}
.arrd-center{text-align:center;align-items:center}
.arrd-h{font:900 clamp(30px,8vw,40px)/1 var(--head);font-stretch:125%;text-transform:uppercase;letter-spacing:-.02em;margin:2px 0 0;color:var(--white);text-wrap:balance}
.arrd-lede{color:var(--muted);margin:0;font-size:15px}
.arrd-svg{width:min(330px,74vw,40vh);aspect-ratio:1/1;display:block;margin:2px auto 0;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.arrd-svg:focus-visible{outline:3px solid var(--yellow);outline-offset:4px;border-radius:50%}
.arrd-scar{font:500 13px/1.35 var(--sub);text-transform:uppercase;letter-spacing:.07em;color:var(--yellow);margin:0;min-height:1.35em;text-wrap:balance}
.arrd-links{display:flex;justify-content:center;align-items:center;gap:6px;color:var(--muted)}
.arrd-btn{display:flex;justify-content:center;align-items:center;font:600 17px/1 var(--sub);text-transform:uppercase;letter-spacing:.1em;padding:17px 22px;border-radius:10px;text-decoration:none;background:var(--red);color:#fff;border:2px solid var(--red);cursor:pointer;width:100%;margin:0}
.arrd-btn:hover{filter:brightness(1.06)}
.arrd-btn[disabled]{opacity:.6;cursor:wait}
.arrd-btn.ghost{background:transparent;color:var(--white);border-color:rgba(249,247,248,.5)}
.arrd-no{background:none;border:0;color:var(--muted);font:500 14px/1.4 var(--body);text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:6px;align-self:center}
.arrd-call{margin:0;font-size:14px;color:var(--white);text-align:center}
.arrd-call a{color:var(--lb);font-weight:700;text-decoration:none;white-space:nowrap}
.arrd-link{background:none;border:0;color:var(--muted);font:400 12.5px/1.4 var(--body);text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:2px;align-self:center}
.arrd-odds{font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:10px;width:100%}
.arrd-odds div{display:flex;justify-content:space-between;gap:10px;padding:2px 0;font-variant-numeric:tabular-nums}
.arrd-odds i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:8px;vertical-align:-1px}
.arrd-odds .off{text-decoration:line-through;opacity:.6}
.arrd-odds a{color:var(--lb)}
.arrd-won{font:600 14px/1.3 var(--sub);text-transform:uppercase;letter-spacing:.1em;color:var(--yellow);margin:6px 0 0}
.arrd-gift{font:900 clamp(26px,7vw,34px)/1.02 var(--head);font-stretch:125%;text-transform:uppercase;letter-spacing:-.02em;color:var(--white);margin:0;text-wrap:balance}
.arrd-sub{color:var(--muted);margin:0;font-size:15px}
.arrd-hold{margin:0;font:500 14px/1.4 var(--sub);text-transform:uppercase;letter-spacing:.07em;color:var(--white)}
.arrd-hold b{color:var(--yellow);font-variant-numeric:tabular-nums;font-weight:600}
.arrd-form{display:flex;flex-direction:column;gap:11px;margin:4px 0 0}
.arrd-field{display:flex;flex-direction:column;gap:5px}
.arrd-field label{font:600 13.5px/1.3 var(--body);color:var(--white)}
.arrd-field input{font:400 17px/1.3 var(--body);padding:12px 13px;border-radius:9px;border:2px solid transparent;background:#fff;color:var(--black);width:100%;margin:0;height:auto;box-shadow:none}
.arrd-field input:focus{outline:none;border-color:var(--lb)}
.arrd-field input[aria-invalid="true"]{border-color:var(--red)}
.arrd-row{display:grid;grid-template-columns:minmax(0,1fr) 100px;gap:10px}
.arrd-note{margin:0;font-size:14px;color:var(--white)}
.arrd-check{display:flex;gap:10px;align-items:flex-start;font:400 12.5px/1.45 var(--body);color:var(--muted);cursor:pointer}
.arrd-check input{width:19px;height:19px;margin:1px 0 0;accent-color:var(--lb);flex:none}
.arrd-err{color:#ff8a8d;font:600 14px/1.4 var(--body);margin:0}
.arrd-err:empty{display:none}
.arrd-fine{font:400 12px/1.5 var(--body);color:var(--muted);margin:0}
.arrd-fine a{color:var(--muted)}
.arrd-code{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:var(--gray);border-radius:12px;padding:14px 16px;border:2px dashed #a9bcd6}
.arrd-code b{font:900 clamp(26px,7vw,32px)/1 var(--head);font-stretch:112%;letter-spacing:.04em;white-space:nowrap;user-select:all;color:var(--black)}
.arrd-copy{font:600 13px/1 var(--sub);text-transform:uppercase;letter-spacing:.08em;padding:10px 12px;border-radius:8px;border:2px solid var(--blue);background:transparent;color:var(--blue);cursor:pointer}
.arrd-ok{margin:0;color:var(--lb);font-weight:600;font-size:14px}
.arrd-tab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147482999;writing-mode:vertical-rl;background:var(--navy);color:var(--white);border:0;border-left:4px solid var(--red);border-radius:10px 0 0 10px;padding:16px 9px;font:600 13px/1 var(--sub);text-transform:uppercase;letter-spacing:.12em;cursor:pointer;box-shadow:0 8px 24px -10px rgba(0,0,0,.5)}
@media (max-width:640px){.arrd-tab{padding:13px 7px;font-size:12px}}
@media (prefers-reduced-motion:reduce){.arrd-sheet{animation:none!important}}
`;

/* ---------------- markup ---------------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MARKUP = `
<div class="arrd-sheet" role="dialog" aria-modal="true" aria-labelledby="arrd-title">
  <div class="arrd-head">
    <img class="arrd-logo" src="${esc(CFG.logoUrl)}" alt="Always Ready Repair">
    <button class="arrd-x" type="button" aria-label="Close" data-arrd="close">×</button>
  </div>
  <section class="arrd-sec arrd-center" data-arrd="play">
    <h2 class="arrd-h" id="arrd-title">Turn the dial</h2>
    <p class="arrd-lede">Every turn wins a real gift. Odds are posted.</p>
    <svg class="arrd-svg" data-arrd="svg" viewBox="-172 -172 344 344" role="img" tabindex="0" aria-label="Comfort Dial thermostat with gifts on a 50 to 90 degree scale. Press Turn the dial.">${svgInner()}
    </svg>
    <p class="arrd-scar" data-arrd="scar" aria-live="polite"></p>
    <p class="arrd-err" data-arrd="playErr" role="alert"></p>
    <button class="arrd-btn" type="button" data-arrd="turn">Turn the dial</button>
    <div data-arrd="ts"></div>
    <p class="arrd-call">No heat right now? <a href="tel:${TEL}" data-arrd="call">Call ${esc(DIAL.phone)}</a></p>
    <div class="arrd-links"><button class="arrd-no" type="button" data-arrd="close">No thanks</button><span aria-hidden="true">·</span><button class="arrd-no" type="button" data-arrd="oddsBtn" aria-expanded="false">Odds &amp; rules</button></div>
    <div class="arrd-odds" data-arrd="odds" hidden></div>
  </section>
  <section class="arrd-sec" data-arrd="claim" hidden></section>
  <section class="arrd-sec" data-arrd="done" hidden></section>
  <section class="arrd-sec" data-arrd="msg" hidden></section>
</div>`;

/* ---------------- dial geometry (face.js draws it) ---------------- */
let root, tab, $, segs = [], ang = fToAng(68), lastF = null, busy = false, memOpen = true, isOpen = false, lastFocus = null, ac = null;
let statusLoaded = false, clock = null, paused = false;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function buildRing() { drawRing($('ring')); }
function buildFace() {
  segs = drawFace($('face'), DIAL.zones, GIFTS, memOpen ? null : MEM);
  setAng(ang, false);
}
function setHub(main, sub, lbl) {
  $('hubMain').textContent = main;
  const s = $('hubSub'); s.textContent = sub; s.setAttribute('font-size', sub.length > 15 ? 8.6 : sub.length > 11 ? 9.6 : 10.5);
  if (lbl) $('hubLabel').textContent = lbl;
}
const zoneAt = (a) => { a = Math.max(A0, Math.min(A1 - 0.001, a)); return segs.find((s) => a >= s.a0 && a < s.a1) || segs[0]; };
function setAng(a, live) {
  ang = a;
  $('ring').setAttribute('transform', `rotate(${a})`);
  $('marker').setAttribute('transform', `rotate(${a})`);
  if (live) {
    const f = Math.round(angToF(a));
    if (f !== lastF) { lastF = f; tick(1400 + (f - 50) * 12); }
    setHub(`${f}°`, zoneAt(a).gift.short, 'SET TO');
  }
}

/* ---------------- sound: quiet thermostat clicks, only after the visitor's own tap ---------------- */
function audio() { try { ac = ac || new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)(); } catch (e) { ac = null; } return ac; }
function tick(freq) {
  const c = ac; if (!c) return;
  try { const o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.035, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.03);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 0.035); } catch (e) {}
}
function chime() {
  const c = ac; if (!c) return;
  try { [660, 880, 1320].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * 0.09;
    o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.4); }); } catch (e) {}
}

/* ---------------- the turn: heat stop, cool stop, settle (no overshoot, so the readout never shows a gift it didn't land on) ---------------- */
const easeIO = (k) => -(Math.cos(Math.PI * k) - 1) / 2;
const easeOut = (k) => 1 - Math.pow(1 - k, 4);
const tween = (from, to, dur, ease) => new Promise((res) => {
  const t0 = performance.now();
  (function f(now) { const k = Math.min(1, (now - t0) / dur); setAng(from + (to - from) * ease(k), true); k < 1 ? requestAnimationFrame(f) : res(); })(t0);
});
async function turnTo(giftId) {
  const mine = segs.filter((s) => s.gift.id === giftId), tot = mine.reduce((n, s) => n + (s.a1 - s.a0), 0);
  if (!mine.length) return;
  let r = Math.random() * tot, s = mine[0];
  for (const x of mine) { if ((r -= x.a1 - x.a0) < 0) { s = x; break; } }
  const target = s.a0 + (s.a1 - s.a0) * (0.25 + Math.random() * 0.5);
  if (reduce()) { await tween(ang, target, 450, easeIO); return; }
  await tween(ang, A1, 280 + (A1 - ang) * 3, easeIO);
  await tween(A1, A0, 1100, easeIO);
  await tween(A0, target, 1900, easeOut);
}

/* ---------------- API ---------------- */
async function api(path, body) {
  const r = await fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers: { accept: 'application/json' } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}

/* ---------------- Turnstile: an invisible bot check, loaded only when the popup opens and a site key is set ---------------- */
let tsKey = null, tsId = null, tsToken = null, tsWaiters = [];
function loadTurnstile(key) {
  if (!key || tsKey) return;
  tsKey = key;
  window.__arrdTurnstile = () => {
    try {
      tsId = window.turnstile.render($('ts'), {
        sitekey: key, appearance: 'interaction-only',
        callback: (t) => { tsToken = t; tsWaiters.splice(0).forEach((f) => f(t)); },
        'expired-callback': () => { tsToken = null; try { window.turnstile.reset(tsId); } catch (e) {} },
        'error-callback': () => { tsWaiters.splice(0).forEach((f) => f(null)); }
      });
    } catch (e) {}
  };
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__arrdTurnstile';
  s.async = true; document.head.appendChild(s);
}
function turnstileToken() {
  if (!tsKey) return Promise.resolve(null);
  const use = (t) => { tsToken = null; setTimeout(() => { try { window.turnstile.reset(tsId); } catch (e) {} }, 0); return t; };   // tokens are single-use
  if (tsToken) return Promise.resolve(use(tsToken));
  return new Promise((res) => { tsWaiters.push((t) => res(t ? use(t) : null)); setTimeout(() => res(null), 10000); });
}

/* ---------------- status line and odds ---------------- */
const monthLabel = (ym) => { if (!ym) return ''; const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long' }); };
function renderScarcity(st) {
  let text = '';
  if (st && st.membershipsLeft === 0) text = 'This season\'s free years are all claimed';
  else if (st && st.membershipOpen) text = `${monthLabel(st.month)}'s free year is still up for grabs`;
  else if (st && st.nextUnlock) text = `${monthLabel(st.month)}'s free year is taken. Next one: ${monthLabel(st.nextUnlock).slice(0, 3)} 1`;
  $('scar').textContent = text;
}
function renderOdds() {
  if (!root) return;
  const pool = DIAL.gifts.filter((g) => g.id !== MEM || memOpen), tot = pool.reduce((s, g) => s + g.weight, 0);
  $('odds').innerHTML = DIAL.gifts.map((g) => {
    const on = pool.includes(g), p = on ? g.weight / tot * 100 : 0;
    return `<div><span class="${on ? '' : 'off'}"><i style="background:${g.fill}"></i>${esc(g.name)}</span><span>${on ? (p % 1 ? p.toFixed(1) : p) + '%' : 'Claimed'}</span></div>`;
  }).join('') + `<div style="margin-top:4px"><span>Chance of winning something</span><span>100%</span></div>
    <p class="arrd-fine" style="margin-top:8px">One gift per phone and per household. Codes expire ${DIAL.expiresDays} days after you claim them. Residential customers in ARR's service area. No purchase needed to play. <a href="${esc(RULES_URL)}" target="_blank" rel="noopener">Official rules</a></p>`;
}
let statusReq = null;
const getStatus = () => (statusReq ||= api('status').then((st) => {
  if (st && st.dial) applyDial(st.dial);
  if (st) paused = st.enabled === false;
  return st;
}).catch(() => { statusReq = null; return null; }));
async function loadStatus() {
  if (statusLoaded) return;
  const st = await getStatus();
  if (!st) return;
  statusLoaded = true;
  if (st.enabled === false) { if (!$('play').hidden) showMsg('The dial is resting', `We can still take care of you. Call ${DIAL.phone}.`); return; }
  memOpen = !!st.membershipOpen;
  renderScarcity(st); renderOdds(); buildFace();
  loadTurnstile(st.turnstileSiteKey);
}

/* ---------------- screens ---------------- */
function show(name) {
  ['play', 'claim', 'done', 'msg'].forEach((k) => { $(k).hidden = k !== name; });
  if (name !== 'claim') stopClock();
  $('sheet').scrollTop = 0;
}
function focusFirst(sel) { setTimeout(() => { const n = root.querySelector(sel); if (n) n.focus(); }, 60); }

function showPlay() {
  show('play');
  const b = $('turn'); b.disabled = false; b.textContent = 'Turn the dial';
  $('playErr').textContent = '';
  setHub(`${Math.round(angToF(ang))}°`, 'TAP TO TURN', 'SET TO');
}

function showMsg(title, text, action) {
  show('msg');
  const m = $('msg');
  m.innerHTML = `<p class="arrd-won">${esc(title)}</p><p class="arrd-sub" style="color:#f9f7f8">${esc(text)}</p>
    ${action ? `<button class="arrd-btn" type="button" data-arrd="msgAct">${esc(action.label)}</button>` : ''}
    <a class="arrd-btn ghost" href="tel:${TEL}" data-arrd="call">Call ${esc(DIAL.phone)}</a>
    <button class="arrd-no" type="button" data-arrd="close">Back to the site</button>`;
  if (action) m.querySelector('[data-arrd="msgAct"]').addEventListener('click', action.run);
}

function fmtClock(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function stopClock() { if (clock) { clearInterval(clock); clock = null; } }
function startClock(heldUntil) {
  stopClock();
  const end = new Date(heldUntil).getTime();
  const draw = () => {
    const left = end - Date.now(), c = root.querySelector('[data-arrd="clock"]');
    if (c) c.textContent = fmtClock(left);
    if (left <= 0) { stopClock(); if (!busy) holdExpired(); }
  };
  draw(); clock = setInterval(draw, 1000);
}
function holdExpired() {
  store.set({ hold: null });
  track('dial_hold_expired');
  showMsg('Your hold ran out', `We held your gift for ${DIAL.holdMinutes} minutes. Turn again for a new one.`, { label: 'Turn again', run: showPlay });
}

function showClaim(hold) {
  show('claim');
  const g = GIFTS[hold.gift.id] || hold.gift, isMem = hold.gift.id === MEM;
  const c = $('claim');
  c.innerHTML = `
    <p class="arrd-won">You won</p>
    <p class="arrd-gift">${esc(g.name)}</p>
    <p class="arrd-sub">${esc(g.sub)}.</p>
    <p class="arrd-hold">We're holding it for <b data-arrd="clock">${DIAL.holdMinutes}:00</b></p>
    <form class="arrd-form" data-arrd="claimForm" novalidate>
      <div class="arrd-field"><label for="arrd-phone">Mobile number</label><input id="arrd-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="20" placeholder="(708) 555-0142"></div>
      ${isMem ? `<p class="arrd-note">The free year is tied to one home. Where's yours?</p>
      <div class="arrd-row">
        <div class="arrd-field"><label for="arrd-street">Street address</label><input id="arrd-street" name="street" autocomplete="address-line1" maxlength="120"></div>
        <div class="arrd-field"><label for="arrd-zip">ZIP</label><input id="arrd-zip" name="zip" inputmode="numeric" maxlength="5" autocomplete="postal-code"></div>
      </div>` : ''}
      <label class="arrd-check"><input type="checkbox" id="arrd-rem"> <span>Also text me a reminder before it expires, plus occasional offers from ARR. Up to 4 msgs/month. Msg &amp; data rates may apply. Reply STOP to opt out. Not required to win.</span></label>
      <p class="arrd-err" data-arrd="claimErr" role="alert"></p>
      <button class="arrd-btn" type="submit" data-arrd="claimBtn">Text me my code</button>
      <p class="arrd-fine">We'll text your code to this number. Msg &amp; data rates may apply. One gift per phone and per household. Expires ${DIAL.expiresDays} days after you claim it. <a href="${esc(RULES_URL)}" target="_blank" rel="noopener">Official rules</a></p>
    </form>`;
  c.querySelector('form').addEventListener('submit', (e) => claim(e, hold));
  startClock(hold.heldUntil);
  focusFirst('#arrd-phone');
}

function showDone(won, returning) {
  show('done');
  const g = GIFTS[won.gift.id] || won.gift, d = $('done');
  d.innerHTML = `
    <p class="arrd-won">${returning ? 'Your gift' : 'You\'re set'}</p>
    <p class="arrd-gift">${esc(g.name)}</p>
    <div class="arrd-code"><b data-arrd="code">${esc(won.code)}</b><button class="arrd-copy" type="button" data-arrd="copy">Copy</button></div>
    <p class="arrd-sub" style="color:#f9f7f8">Good through ${esc(won.expiresOn)}. Give this code when you book. It's tied to your phone number${returning ? '' : ', and we just texted it to you'}.</p>
    <a class="arrd-btn" href="tel:${TEL}" data-arrd="call">Call to book</a>
    <a class="arrd-btn ghost" href="${esc(DIAL.bookUrl)}" data-arrd="book">Book online</a>
    ${won.hasAddress ? '' : `<button class="arrd-link" type="button" data-arrd="detailsBtn" style="font-size:14px;color:#f9f7f8">Add your address so we can book you faster</button>
    <form class="arrd-form" data-arrd="detailsForm" novalidate hidden>
      <div class="arrd-field"><label for="arrd-first">First name</label><input id="arrd-first" name="firstName" autocomplete="given-name" maxlength="30"></div>
      <div class="arrd-row">
        <div class="arrd-field"><label for="arrd-dstreet">Street address</label><input id="arrd-dstreet" name="street" autocomplete="address-line1" maxlength="120"></div>
        <div class="arrd-field"><label for="arrd-dzip">ZIP</label><input id="arrd-dzip" name="zip" inputmode="numeric" maxlength="5" autocomplete="postal-code"></div>
      </div>
      <p class="arrd-err" data-arrd="detailsErr" role="alert"></p>
      <button class="arrd-btn ghost" type="submit">Save my address</button>
    </form>`}
    <button class="arrd-no" type="button" data-arrd="close">Back to the site</button>`;
  d.querySelector('[data-arrd="copy"]').addEventListener('click', (e) => {
    const b = e.currentTarget, done = () => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1600); };
    const sel = () => { const rg = document.createRange(); rg.selectNodeContents(d.querySelector('[data-arrd="code"]')); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); };
    try { navigator.clipboard.writeText(won.code).then(done, sel); } catch (err) { sel(); }
  });
  const btn = d.querySelector('[data-arrd="detailsBtn"]'), form = d.querySelector('[data-arrd="detailsForm"]');
  if (btn) btn.addEventListener('click', () => { btn.hidden = true; form.hidden = false; focusFirst('#arrd-first'); });
  if (form) form.addEventListener('submit', (e) => saveDetails(e, won, form));
  setHub('✓', g.short, 'YOUR GIFT');
}

/* ---------------- actions ---------------- */
async function turn() {
  if (busy) return;
  audio();   // unlock sound inside the tap
  busy = true;
  const b = $('turn'); b.disabled = true; b.textContent = 'Turning…'; $('playErr').textContent = '';
  track('dial_turn_pressed');
  let res;
  try {
    res = await api('turn', { device, token: await turnstileToken(), context: visitContext() });
  } catch (e) { res = { error: `We couldn't reach the dial. Check your connection, or call ${DIAL.phone}.` }; }
  if (!res.ok) {
    busy = false; b.disabled = false; b.textContent = 'Turn the dial';
    if (res.reason === 'limit') showMsg('That\'s all for today', res.error);
    else $('playErr').textContent = res.error || `Something went wrong on our end. Call ${DIAL.phone}.`;
    return;
  }
  if (res.gift.id === MEM && !memOpen) { memOpen = true; buildFace(); renderOdds(); }   // the status line was stale: show the slice it lands on
  if (!segs.some((x) => x.gift.id === res.gift.id)) { statusReq = null; await getStatus(); }   // the config changed since the dial was drawn
  await turnTo(res.gift.id);
  chime();
  const hold = { turn: res.turn, gift: res.gift, heldUntil: res.heldUntil };
  store.set({ hold });
  track('dial_turned', { gift: res.gift.id });
  busy = false;
  setTimeout(() => showClaim(hold), reduce() ? 0 : 450);
}

function fieldError(scope, field, msg) {
  scope.querySelectorAll('input').forEach((i) => i.removeAttribute('aria-invalid'));
  scope.querySelector('.arrd-err').textContent = msg || '';
  const map = { phone: '#arrd-phone', street: '#arrd-street,#arrd-dstreet', zip: '#arrd-zip,#arrd-dzip', firstName: '#arrd-first' };
  const input = field && map[field] && scope.querySelector(map[field]);
  if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
}

async function claim(e, hold) {
  e.preventDefault();
  if (busy) return;
  const f = e.currentTarget, v = (sel) => { const n = f.querySelector(sel); return n ? n.value : undefined; };
  const phone = v('#arrd-phone') || '';
  if (phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').length !== 10) { fieldError(f, 'phone', 'Enter a 10-digit mobile number. Your code is texted there.'); return; }
  busy = true;
  const b = f.querySelector('[data-arrd="claimBtn"]'); b.disabled = true; b.textContent = 'Sending…'; fieldError(f, null, '');
  let res;
  try {
    res = await api('claim', { turn: hold.turn, phone, street: v('#arrd-street'), zip: v('#arrd-zip'), reminders: f.querySelector('#arrd-rem').checked, utm: UTM, page: location.href.slice(0, 300) });
  } catch (err) { res = { error: `We couldn't reach the dial. Check your connection, or call ${DIAL.phone}.` }; }
  busy = false; b.disabled = false; b.textContent = 'Text me my code';
  if (!res.ok) {
    if (['expired', 'no_turn', 'household'].includes(res.reason)) {
      store.set({ hold: null });
      showMsg(res.reason === 'household' ? 'One free year per home' : 'Your hold ran out', res.error, { label: 'Turn again', run: showPlay });
    } else if (res.reason === 'limit') showMsg('That\'s all for today', res.error);
    else fieldError(f, res.field, res.error || `Something went wrong on our end. Call ${DIAL.phone}.`);
    return;
  }
  stopClock();
  if (res.duplicate) {
    store.set({ hold: null });
    track('dial_duplicate');
    showMsg('This number already has a gift', res.message);
    return;
  }
  const won = { code: res.code, gift: res.gift, expiresAt: res.expiresAt, expiresOn: res.expiresOn, turn: hold.turn, hasAddress: !!res.hasAddress };
  store.set({ won, hold: null });
  track('dial_claimed', { gift: res.gift.id, reminders: f.querySelector('#arrd-rem').checked });
  showDone(won, false);
}

async function saveDetails(e, won, form) {
  e.preventDefault();
  if (busy) return;
  const v = (sel) => form.querySelector(sel).value;
  busy = true; const b = form.querySelector('button[type="submit"]'); b.disabled = true; fieldError(form, null, '');
  let res;
  try { res = await api('details', { turn: won.turn, firstName: v('#arrd-first'), street: v('#arrd-dstreet'), zip: v('#arrd-dzip') }); }
  catch (err) { res = { error: `That didn't save. Give us your address when you call ${DIAL.phone}.` }; }
  busy = false; b.disabled = false;
  if (!res.ok) { fieldError(form, res.field, res.error); return; }
  store.set({ won: { ...won, hasAddress: true } });
  track('dial_address_added');
  form.outerHTML = '<p class="arrd-ok">Thanks, we have your address. Mention your code when you call.</p>';
}

/* ---------------- open / close ---------------- */
function focusables() { return [...root.querySelectorAll('button:not([disabled]),a[href],input,[tabindex="0"]')].filter((n) => !n.closest('[hidden]') && n.offsetParent !== null); }
function onKey(e) {
  if (e.key === 'Escape') { close(); return; }
  if (e.key === 'Tab') {
    const f = focusables(); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}
const live = (o) => o && new Date(o.expiresAt || o.heldUntil) > new Date();

function open(trigger = 'button') {
  mount(); loadFonts();
  if (isOpen) return;
  isOpen = true; lastFocus = document.activeElement;
  root.hidden = false; document.documentElement.classList.add('arrd-open'); tab.hidden = true;
  document.addEventListener('keydown', onKey);
  store.set({ seenAt: Date.now() });
  const s = store.get();
  if (live(s.won)) showDone(s.won, true);
  else if (live(s.hold)) showClaim(s.hold);
  else { showPlay(); focusFirst('[data-arrd="turn"]'); }
  loadStatus();
  track('dial_opened', { trigger });
}
function close() {
  if (!root || !isOpen || busy) return;
  isOpen = false; root.hidden = true; stopClock();
  document.documentElement.classList.remove('arrd-open');
  document.removeEventListener('keydown', onKey);
  track('dial_closed');
  updateTab();
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

/* The side tab: after the popup has been seen, it stays on the right edge (the bottom corners belong to Podium and the
 * accessibility button). It reads YOUR CODE after a win and CLAIM YOUR GIFT while one is held. */
function updateTab() {
  if (!tab || isOpen) return;
  const s = store.get();
  const show = CFG.tab && !excluded() && s.seenAt && ((variant === 'dial' && !paused) || live(s.won) || live(s.hold));
  tab.hidden = !show;
  tab.textContent = live(s.won) ? 'Your code' : live(s.hold) ? 'Claim your gift' : 'Turn the dial';
}

/* Fonts load on first open, not on every page view of the site. */
function loadFonts() {
  if (document.querySelector('link[data-arrd-fonts]')) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.arrdFonts = '1';
  l.href = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,700..900&family=Oswald:wght@500;600&family=Inter:wght@400;500;600;700&display=swap';
  document.head.appendChild(l);
}

function mount() {
  if (root) return;
  const st = document.createElement('style'); st.id = 'arrd-css'; st.textContent = CSS; document.head.appendChild(st);
  root = document.createElement('div'); root.className = 'arrd-root'; root.hidden = true; root.innerHTML = MARKUP;
  document.body.appendChild(root);
  tab = document.createElement('button'); tab.type = 'button'; tab.className = 'arrd-tab'; tab.hidden = true;
  tab.addEventListener('click', () => open('tab'));
  document.body.appendChild(tab);
  $ = (k) => (k === 'sheet' ? root.querySelector('.arrd-sheet') : root.querySelector(`[data-arrd="${k}"]`));
  buildRing(); buildFace(); renderOdds();
  root.addEventListener('click', (e) => {
    if (e.target === root) { close(); return; }
    if (e.target.closest('[data-arrd="close"]')) { if (e.target.closest('.arrd-no')) track('dial_no_thanks'); close(); }
    if (e.target.closest('[data-arrd="call"]')) track('dial_call_clicked');
    if (e.target.closest('[data-arrd="book"]')) track('dial_book_clicked');
  });
  $('turn').addEventListener('click', turn);
  $('svg').addEventListener('click', () => { if (!$('play').hidden) turn(); });
  $('svg').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !$('play').hidden) { e.preventDefault(); turn(); } });
  $('oddsBtn').addEventListener('click', () => {
    const o = $('odds'); o.hidden = !o.hidden;
    $('oddsBtn').setAttribute('aria-expanded', String(!o.hidden));
    $('oddsBtn').textContent = o.hidden ? 'Odds & rules' : 'Hide odds & rules';
  });
}

/* ---------------- when it opens by itself ---------------- */
function excluded() { const p = location.pathname.replace(/\/$/, '') || '/'; return CFG.excludePaths.some((x) => p === x || p.startsWith(x)); }
const visible = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
function pricingOpen() { return visible(document.getElementById('arr-pricing-modal')) || !!document.querySelector('dialog[open]'); }
function typing() { const a = document.activeElement; return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable); }
function mayAutoOpen() {
  if (variant !== 'dial' || paused || isOpen || excluded()) return false;
  const s = store.get();
  if (live(s.won)) return false;
  if (s.seenAt && Date.now() - s.seenAt < CFG.snoozeDays * 864e5) return false;
  return true;
}
async function tryAuto(retried) {
  if (!mayAutoOpen()) return;
  const st = await getStatus();
  if (!st || st.enabled === false) return;   // never interrupt a visitor just to say the dial is down
  if (pricingOpen() || typing()) { if (!retried) setTimeout(() => tryAuto(true), 6000); return; }
  open('auto');
}

/* The group, the side tab and the auto-open wait for /api/status: they follow the admin's settings. If it doesn't
 * answer, the bundled settings decide the group and the dial doesn't open by itself. */
async function init() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-arr-dial="open"]');
    if (t) { e.preventDefault(); open('button'); }
  });
  let forced = false;
  try { forced = new URLSearchParams(location.search).get('dial') === '1'; } catch (e) {}
  const t0 = Date.now();
  mount();
  if (forced) { assign(); track('dial_assigned'); open('link'); return; }
  await getStatus();
  assign(); track('dial_assigned'); updateTab();
  if (mayAutoOpen()) setTimeout(() => tryAuto(false), Math.max(0, CFG.delayMs - (Date.now() - t0)));
}

window.ARRDial = { open, close, get variant() { return variant; }, reset: () => { try { localStorage.removeItem(STORE); } catch (e) {} } };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
