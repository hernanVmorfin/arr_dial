/* Comfort Dial: the gift popup for alwaysreadyrepair.com. Builds to <base>/dial.js (astro.config.mjs) and drops into
 * Webflow site-wide custom code with:
 *   <script type="module" src="/dial/dial.js"></script>
 *
 * Gifts, odds, the dial layout and when it opens by itself all come from /api/status: the live config published in
 * the admin (<base>admin). data/dial.json is bundled only as the fallback drawn before that answer arrives.
 *
 * An ARR smart thermostat on the wall: gifts sit on a 50–90°F ring (face.js), arc length = the real odds, the free
 * year raised as the top prize. Turn first, claim second: one tap turns the dial (/api/turn picks the gift, never
 * this file, and holds it for a few minutes), then a mobile number claims it (/api/claim). A free-year winner also
 * gives a home address. The screen wakes with the time and the visitor's own weather (/api/weather), heats (red) while
 * the needle climbs and cools (blue) while it falls, shows a HOLD countdown while they claim, and ends on their code.
 *
 * Opens by itself once the visitor has had the site on screen for delayMs this visit (counted across pages), for
 * visitors in the dial share of the test (split), on any page not in excludePaths. Never on top of the pricing popup,
 * never after a win, not again for snoozeDays
 * after it was seen, never while the dial is paused in the admin. ?dial=1 in the URL, [data-arr-dial="open"] clicks
 * and window.ARRDial.open() always open it.
 * Those settings are the admin's. window.__ARR_DIAL__ can still set them, but the admin's win once /api/status
 * answers; `force: {...}` in it wins over the admin (the QA page uses that).
 * Vanilla JS, every class prefixed arrd- and every rule under .arrd-root, because it lives on someone else's page. */
import BUILT_IN from '../../data/dial.json';
import { svgInner, drawFace, hubSize, angToF, fToAng, A0, A1, VIEWBOX } from './face.js';
import { adParams, pathOf, referrerOf, cookieOf, gaClientId, klaviyoExchangeId, deviceKind, UTM_KEYS } from '../lib/visit.js';
import { scarcityLine } from '../lib/rules.js';

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
    root.querySelectorAll('[data-arrd="call"]').forEach((a) => {
      a.href = `tel:${TEL}`;
      if (a.classList.contains('arrd-side')) a.setAttribute('aria-label', `Call ${DIAL.phone}`);
      else if (/^Call\b/.test(a.textContent) && a.textContent !== 'Call to book') a.textContent = `Call ${DIAL.phone}`;
    });
    root.querySelectorAll('[data-arrd="book"]').forEach((a) => { a.href = DIAL.bookUrl; });
  }
}

/* ---------------- state that outlives the page: the device id, test group, a held gift, a win, sound off ---------------- */
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

/* ---------------- tracking: GTM dataLayer (dial_variant rides on every event for a split-test read) ---------------- */
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

/* ---------------- icons (Feather, MIT; flame from Tabler, MIT) ---------------- */
const PATHS = {
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
  flame: '<path d="M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z"/>',
  sound: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  mute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  drop: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  rain: '<line x1="16" y1="13" x2="16" y2="21"/><line x1="8" y1="13" x2="8" y2="21"/><line x1="12" y1="15" x2="12" y2="23"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>',
  snow: '<path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/><line x1="8" y1="16" x2="8.01" y2="16"/><line x1="8" y1="20" x2="8.01" y2="20"/><line x1="12" y1="18" x2="12.01" y2="18"/><line x1="12" y1="22" x2="12.01" y2="22"/><line x1="16" y1="16" x2="16.01" y2="16"/><line x1="16" y1="20" x2="16.01" y2="20"/>',
  flake: [0, 60, 120, 180, 240, 300].map((r) => `<path transform="rotate(${r} 12 12)" d="M12 12V2.5M9.5 4.5l2.5 2 2.5-2"/>`).join(''),
  storm: '<path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/><polyline points="13 11 9 17 15 17 11 23"/>',
  wind: '<path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>'
};
const icon = (n, cls = '') => `<svg class="arrd-i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[n] || PATHS.cloud}</svg>`;

/* ---------------- styles ---------------- */
/* The sheet is a warm wall and the thermostat hangs on it. Text on the glass is sized in cqw (1% of the glass width),
 * so the screen reads the same at 250 px on a phone as at 350 px on a laptop. */
const CSS = `
html.arrd-open{overflow:hidden}
html.arrd-open iframe[id^="podium"],html.arrd-open #podium-website-widget{visibility:hidden!important}
.arrd-root,.arrd-tab{--blue:#084e91;--red:#ee292f;--lb:#03bce6;--white:#f9f7f8;--black:#221f20;--navy:#14284e;--gray:#dee5ee;--yellow:#ffcc04;--muted:#5c6672;--soft:#a9bcd6;--line:#c9d4e2;
  --head:"Archivo","Helvetica Neue",Arial,sans-serif;--sub:"Oswald","Barlow Condensed","Arial Narrow",sans-serif;--body:"Inter",-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.arrd-root,.arrd-root *,.arrd-tab{box-sizing:border-box}
.arrd-root[hidden],.arrd-root [hidden],.arrd-tab[hidden]{display:none!important}
.arrd-root{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(20,40,78,.55);font-family:var(--body);color:var(--black);line-height:1.5;-webkit-font-smoothing:antialiased;text-align:left}
.arrd-root p{margin:0}
.arrd-sheet{position:relative;width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow-y:auto;overscroll-behavior:contain;background:radial-gradient(120% 80% at 30% 0%,#f9f7f8 0%,#dee5ee 72%,#c9d4e2 100%);border-radius:18px;box-shadow:0 24px 70px -20px rgba(0,0,0,.6);padding:12px 24px 22px;animation:arrd-in .3s ease-out}
@keyframes arrd-in{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
@keyframes arrd-up{from{transform:translateY(100%)}to{transform:none}}
@media (max-width:640px){
  .arrd-root{align-items:flex-end;padding:0}
  .arrd-sheet{max-width:none;border-radius:18px 18px 0 0;max-height:92vh;padding:10px 18px calc(18px + env(safe-area-inset-bottom,0px));animation:arrd-up .32s cubic-bezier(.2,.8,.2,1)}
}
.arrd-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:40px}
.arrd-brand{font:500 12.5px/1.3 var(--sub);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.arrd-brand b{font-weight:600;color:var(--navy)}
.arrd-x{width:40px;height:40px;border-radius:50%;border:1px solid rgba(20,40,78,.25);background:transparent;color:var(--navy);font:400 24px/1 var(--body);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;flex:none}
.arrd-root button:focus-visible,.arrd-root a:focus-visible,.arrd-root input:focus-visible,.arrd-tab:focus-visible{outline:3px solid var(--blue);outline-offset:3px}
.arrd-glass button:focus-visible,.arrd-glass a:focus-visible{outline-color:var(--yellow);outline-offset:2px}
.arrd-sec{display:flex;flex-direction:column;align-items:stretch;gap:10px;margin-top:4px}
.arrd-center{text-align:center;align-items:center}
.arrd-h{font:900 clamp(26px,7.4vw,36px)/1 var(--head);font-stretch:125%;text-transform:uppercase;letter-spacing:-.02em;margin:2px 0 0;color:var(--blue);text-wrap:balance}
.arrd-lede{color:var(--muted);font-size:15px}

/* ---- the thermostat ---- */
.arrd-dev{position:relative;width:min(350px,84vw,42vh);aspect-ratio:1/1;margin:6px auto 8px;border-radius:22%;padding:1%;background:linear-gradient(135deg,#f9f7f8 0%,#a9bcd6 42%,#5c6672 100%);box-shadow:0 22px 40px -14px rgba(20,40,78,.6),0 6px 12px -4px rgba(20,40,78,.35);transition:width .35s ease}
.arrd-dev.is-small{width:min(250px,62vw,30vh)}
.arrd-glass{position:relative;width:100%;height:100%;border-radius:21.4%;background:#221f20;overflow:hidden;container-type:inline-size;color:var(--white);cursor:pointer;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.arrd-glass::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(135deg,rgba(255,255,255,.1) 0%,rgba(255,255,255,0) 45%),linear-gradient(180deg,rgba(249,247,248,.04) 0%,rgba(34,31,32,0) 50%,rgba(0,0,0,.28) 100%)}
.arrd-i{display:block;width:100%;height:100%}
.arrd-face{position:absolute;inset:0;width:100%;height:100%;display:block}
.arrd-heat,.arrd-cool{opacity:0;transition:opacity .35s}
.arrd-dev[data-state="heating"][data-mode="heat"] .arrd-heat,.arrd-dev[data-state="heating"][data-mode="cool"] .arrd-cool{opacity:1}
.arrd-z,.arrd-root [data-arrd="tag"]{transition:opacity .15s}
.arrd-dev[data-state="heating"] .arrd-z,.arrd-dev[data-state="won"] .arrd-z{opacity:.28}
.arrd-dev[data-state] .arrd-z.is-lit{opacity:1}
.arrd-ly{position:absolute;opacity:0;visibility:hidden;transition:opacity .35s,visibility 0s .35s}
.arrd-dev[data-state="wake"] .arrd-ly[data-show~="wake"],.arrd-dev[data-state="ready"] .arrd-ly[data-show~="ready"],.arrd-dev[data-state="heating"] .arrd-ly[data-show~="heating"],
.arrd-dev[data-state="won"] .arrd-ly[data-show~="won"],.arrd-dev[data-state="code"] .arrd-ly[data-show~="code"]{opacity:1;visibility:visible;transition:opacity .35s}
.arrd-sb{position:absolute;z-index:2;top:5%;left:0;right:0;height:6%;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:4cqw}
.arrd-sb-l{justify-self:end;display:flex;gap:2.6cqw;align-items:center}
.arrd-sb-l .arrd-i{width:3.6cqw;height:3.6cqw}
.arrd-sb-l .arrd-sb-heat{color:var(--red)}
.arrd-sb-l .arrd-sb-cool{color:var(--lb);display:none}
.arrd-dev[data-state="heating"][data-mode="cool"] .arrd-sb-heat{display:none}
.arrd-dev[data-state="heating"][data-mode="cool"] .arrd-sb-cool{display:block}
.arrd-pill{display:inline-flex;align-items:center;gap:1.3cqw;height:5.2cqw;padding:0 3.2cqw;border-radius:99px;background:var(--navy);color:var(--white);font:600 11px/1 var(--body);font-size:3cqw;font-variant-numeric:tabular-nums;white-space:nowrap}
.arrd-pill .arrd-i{width:2.8cqw;height:2.8cqw}
.arrd-pill.sub,.arrd-pill.heat,.arrd-pill.cool,.arrd-pill.hold{font-family:var(--sub);letter-spacing:.1em;text-transform:uppercase}
.arrd-pill.heat{background:var(--red);color:#fff}
.arrd-pill.cool{background:var(--blue);color:#fff}
.arrd-pill.hold{background:var(--yellow);color:var(--navy)}
.arrd-mute{justify-self:start;width:9cqw;height:9cqw;margin:-2cqw 0 -2cqw -2.2cqw;padding:2.4cqw;border:0;border-radius:50%;background:none;color:var(--white);cursor:pointer}
.arrd-side{z-index:2;top:43%;width:12%;display:flex;flex-direction:column;align-items:center;gap:2.4cqw;text-decoration:none}
.arrd-side-c{width:12cqw;height:12cqw;border-radius:50%;background:var(--navy);color:var(--white);display:flex;align-items:center;justify-content:center;transition:background .15s}
.arrd-side-c .arrd-i{width:4.2cqw;height:4.2cqw}
.arrd-side:hover .arrd-side-c{background:var(--blue)}
.arrd-side-l{font:600 2.5cqw/1 var(--sub);letter-spacing:.14em;text-transform:uppercase;color:var(--soft)}
.arrd-dev.is-small .arrd-side{display:none}
.arrd-wx{left:6%;right:6%;top:74.5%;text-align:center;pointer-events:none}
.arrd-wx1{font:400 11px/1.35 var(--body);font-size:2.9cqw;color:var(--soft);display:flex;justify-content:center;align-items:center;gap:1.6cqw}
.arrd-wx1 .arrd-i{width:4.2cqw;height:4.2cqw;color:var(--white)}
.arrd-wx1 b{font-weight:600;font-size:3.6cqw;color:var(--white)}
.arrd-wx2{font:400 10px/1.4 var(--body);font-size:2.75cqw;color:var(--soft);margin-top:1cqw}
.arrd-logo{position:absolute;left:41.5%;top:89%;width:17%;height:auto;opacity:.8;pointer-events:none}
.arrd-wake{inset:14% 6% 14.5%;display:flex;flex-direction:column;align-items:center;text-align:center}
.arrd-wk-time{font:300 22cqw/1 var(--head);letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.arrd-wk-time small{font:600 3.8cqw/1 var(--sub);letter-spacing:.06em;color:var(--soft);vertical-align:top;margin-left:1.6cqw}
.arrd-wk-date{font:500 3.5cqw/1.3 var(--body);color:var(--soft);margin:2.4cqw 0 4.6cqw!important}
.arrd-tiles{display:flex;gap:2.6cqw;justify-content:center}
.arrd-tile{width:26cqw;padding:3cqw 0 2.6cqw;border-radius:4.6cqw;background:rgba(249,247,248,.07);display:flex;flex-direction:column;align-items:center;gap:1.4cqw}
.arrd-tile .arrd-i{width:4.3cqw;height:4.3cqw}
.arrd-tile b{font:800 5.8cqw/1 var(--head);font-stretch:112%}
.arrd-tile span{font:600 2.25cqw/1 var(--sub);letter-spacing:.14em;text-transform:uppercase;color:var(--soft)}
.arrd-tile.drop .arrd-i{color:var(--lb)}
.arrd-tile.heat .arrd-i{color:var(--red)}
.arrd-wk-tap{margin-top:auto!important;border:1.5px solid var(--yellow);color:var(--yellow);border-radius:99px;padding:1.8cqw 5cqw;font:600 2.75cqw/1 var(--sub);letter-spacing:.12em;text-transform:uppercase}
.arrd-wonly{left:8%;right:8%;top:76%;text-align:center;pointer-events:none}
.arrd-wonly .k{font:600 3.4cqw/1 var(--sub);letter-spacing:.2em;text-transform:uppercase;color:var(--yellow)}
.arrd-wonly .s{font:400 2.9cqw/1.35 var(--body);color:var(--soft);margin-top:1.8cqw}
.arrd-codely{inset:13% 8% 14%;display:flex;flex-direction:column;align-items:center;text-align:center;gap:2.4cqw}
.arrd-codely .t{font:600 4cqw/1 var(--body)}
.arrd-codely .panel{width:100%;background:var(--navy);border:1.5px solid rgba(3,188,230,.35);border-radius:5cqw;padding:4cqw 3cqw 3.4cqw;margin-top:1.4cqw}
.arrd-codely .l{font:600 2.6cqw/1 var(--sub);letter-spacing:.24em;text-transform:uppercase;color:var(--soft)}
.arrd-codely .c{font:900 10cqw/1.05 var(--head);white-space:nowrap;font-stretch:112%;color:var(--lb);letter-spacing:.02em;margin:2.2cqw 0 1.6cqw!important;-webkit-user-select:all;user-select:all;cursor:text}
.arrd-codely .g{font:600 4cqw/1.2 var(--sub);letter-spacing:.08em;text-transform:uppercase;margin-top:2cqw!important}
.arrd-codely .d{font:400 3cqw/1.3 var(--body);color:var(--soft)}

/* ---- below the thermostat ---- */
.arrd-scar{font:500 13px/1.35 var(--sub);text-transform:uppercase;letter-spacing:.07em;color:var(--red);min-height:1.35em;text-wrap:balance}
.arrd-links{display:flex;justify-content:center;align-items:center;gap:6px;color:var(--muted)}
.arrd-btn{display:flex;justify-content:center;align-items:center;font:600 17px/1 var(--sub);text-transform:uppercase;letter-spacing:.1em;padding:17px 22px;border-radius:10px;text-decoration:none;background:var(--red);color:#fff;border:2px solid var(--red);cursor:pointer;width:100%;margin:0}
.arrd-btn:hover{filter:brightness(1.06)}
.arrd-btn[disabled]{opacity:.6;cursor:wait}
.arrd-btn.ghost{background:transparent;color:var(--navy);border-color:rgba(20,40,78,.45)}
.arrd-no{background:none;border:0;color:var(--muted);font:500 14px/1.4 var(--body);text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:6px;align-self:center}
.arrd-call{font-size:14px;color:var(--black);text-align:center}
.arrd-call a{color:var(--blue);font-weight:700;text-decoration:none;white-space:nowrap}
.arrd-link{background:none;border:0;color:var(--muted);font:400 12.5px/1.4 var(--body);text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:2px;align-self:center}
.arrd-odds{font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:10px;width:100%;text-align:left}
.arrd-odds div{display:flex;justify-content:space-between;gap:10px;padding:2px 0;font-variant-numeric:tabular-nums;color:var(--black)}
.arrd-odds i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:8px;vertical-align:-1px;box-shadow:inset 0 0 0 1px rgba(20,40,78,.2)}
.arrd-odds .off{text-decoration:line-through;opacity:.6}
.arrd-odds a{color:var(--blue)}
.arrd-won{font:600 14px/1.3 var(--sub);text-transform:uppercase;letter-spacing:.1em;color:var(--red)}
.arrd-gift{font:900 clamp(24px,6.6vw,32px)/1.02 var(--head);font-stretch:125%;text-transform:uppercase;letter-spacing:-.02em;color:var(--blue);text-wrap:balance}
.arrd-sub{color:var(--muted);font-size:15px}
.arrd-hold{font:500 14px/1.4 var(--sub);text-transform:uppercase;letter-spacing:.07em;color:var(--navy)}
.arrd-hold b{color:var(--red);font-variant-numeric:tabular-nums;font-weight:600}
.arrd-form{display:flex;flex-direction:column;gap:11px;margin:4px 0 0}
.arrd-field{display:flex;flex-direction:column;gap:5px}
.arrd-field label{font:600 13.5px/1.3 var(--body);color:var(--black)}
.arrd-field input{font:400 17px/1.3 var(--body);padding:12px 13px;border-radius:9px;border:2px solid var(--line);background:#fff;color:var(--black);width:100%;margin:0;height:auto;box-shadow:none}
.arrd-field input:focus{outline:none;border-color:var(--blue)}
.arrd-field input[aria-invalid="true"]{border-color:var(--red)}
.arrd-row{display:grid;grid-template-columns:minmax(0,1fr) 100px;gap:10px}
.arrd-note{font-size:14px;color:var(--black)}
.arrd-check{display:flex;gap:10px;align-items:flex-start;font:400 12.5px/1.45 var(--body);color:var(--muted);cursor:pointer}
.arrd-check input{width:19px;height:19px;margin:1px 0 0;accent-color:var(--blue);flex:none}
.arrd-err{color:var(--red);font:600 14px/1.4 var(--body)}
.arrd-err:empty{display:none}
.arrd-fine{font:400 12px/1.5 var(--body);color:var(--muted)}
.arrd-fine a{color:var(--muted)}
.arrd-copy{align-self:center;font:600 13px/1 var(--sub);text-transform:uppercase;letter-spacing:.08em;padding:10px 16px;border-radius:8px;border:2px solid var(--blue);background:transparent;color:var(--blue);cursor:pointer}
.arrd-ok{color:var(--blue);font-weight:600;font-size:14px}
.arrd-tab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147482999;writing-mode:vertical-rl;background:var(--navy);color:var(--white);border:0;border-left:4px solid var(--red);border-radius:10px 0 0 10px;padding:16px 9px;font:600 13px/1 var(--sub);text-transform:uppercase;letter-spacing:.12em;cursor:pointer;box-shadow:0 8px 24px -10px rgba(0,0,0,.5)}
@media (max-width:640px){.arrd-tab{padding:13px 7px;font-size:12px}}
@media (prefers-reduced-motion:reduce){.arrd-sheet{animation:none!important}.arrd-dev,.arrd-ly,.arrd-z,.arrd-heat,.arrd-cool{transition:none!important}}
`;

/* ---------------- markup ---------------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MARKUP = `
<div class="arrd-sheet" role="dialog" aria-modal="true" aria-labelledby="arrd-title">
  <div class="arrd-head">
    <p class="arrd-brand"><b>ARR Heating + Cooling</b> · Since 1935</p>
    <button class="arrd-x" type="button" aria-label="Close" data-arrd="close">×</button>
  </div>
  <div class="arrd-sec arrd-center" data-arrd="playTop">
    <h2 class="arrd-h" id="arrd-title">Turn the dial</h2>
    <p class="arrd-lede">Every turn wins a real gift. Odds are posted.</p>
  </div>
  <div class="arrd-dev" data-arrd="dev" data-state="ready">
    <div class="arrd-glass" data-arrd="glass">
      <svg class="arrd-face arrd-ly" data-show="ready heating won" data-arrd="svg" viewBox="${VIEWBOX}" role="img" aria-label="Comfort Dial thermostat with gifts on a 50 to 90 degree scale. Each gift's slice is sized by its odds. Press Turn the dial.">${svgInner()}
      </svg>
      <div class="arrd-sb">
        <span class="arrd-sb-l">${icon('wifi')}${icon('flame', 'arrd-sb-heat')}${icon('flake', 'arrd-sb-cool')}</span>
        <span class="arrd-pill" data-arrd="pill"></span>
        <button class="arrd-mute" type="button" data-arrd="mute" aria-pressed="false" aria-label="Mute the dial's sounds">${icon('sound')}</button>
      </div>
      <a class="arrd-side arrd-ly" data-show="ready heating won" style="left:4%" href="${esc(DIAL.bookUrl)}" data-arrd="book" aria-label="Book online"><span class="arrd-side-c">${icon('cal')}</span><span class="arrd-side-l" aria-hidden="true">Book</span></a>
      <a class="arrd-side arrd-ly" data-show="ready heating won" style="right:4%" href="tel:${TEL}" data-arrd="call" aria-label="Call ${esc(DIAL.phone)}"><span class="arrd-side-c">${icon('phone')}</span><span class="arrd-side-l" aria-hidden="true">Call</span></a>
      <div class="arrd-wx arrd-ly" data-show="ready heating"><p class="arrd-wx1" data-arrd="wx1"></p><p class="arrd-wx2" data-arrd="wx2"></p></div>
      <div class="arrd-wake arrd-ly" data-show="wake">
        <p class="arrd-wk-time"><span data-arrd="wkTime"></span><small data-arrd="wkAmpm"></small></p>
        <p class="arrd-wk-date" data-arrd="wkDate"></p>
        <div class="arrd-tiles" data-arrd="tiles"></div>
        <p class="arrd-wk-tap">Tap to turn the dial</p>
      </div>
      <div class="arrd-wonly arrd-ly" data-show="won"><p class="k">You won</p><p class="s">Held for you. Add your number to claim it.</p></div>
      <div class="arrd-codely arrd-ly" data-show="code">
        <p class="t">Your code</p>
        <div class="panel"><p class="l">Gift code</p><p class="c" data-arrd="code"></p><p class="l">Give it when you book</p></div>
        <p class="g" data-arrd="codeGift"></p>
        <p class="d" data-arrd="codeDate"></p>
      </div>
      <img class="arrd-logo" src="${esc(CFG.logoUrl)}" alt="" aria-hidden="true">
    </div>
  </div>
  <section class="arrd-sec arrd-center" data-arrd="play">
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

/* ---------------- the dial (face.js draws it, on a 400-wide face) ---------------- */
let root, tab, $, segs = [], ang = fToAng(68), lastF = null, busy = false, memOpen = true, isOpen = false, lastFocus = null, ac = null;
let statusLoaded = false, clock = null, uiClock = null, wakeTimer = null, WX = null, muted = !!saved.muted, paused = false;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* The free year sits raised as the top prize while this month's is open, and reads GONE / TAKEN once it's claimed. */
function buildFace() {
  segs = drawFace($('face'), DIAL.zones, GIFTS, { closedId: memOpen ? null : MEM, topId: memOpen ? MEM : null, tag: $('tag') });
  setAng(ang, false);
  if (/^(heating|won)$/.test($('dev').dataset.state)) light(zoneAt(ang));   // rebuilt mid-turn or on the claim screen
}
/* The white disc: SET TO / temperature / the gift under the pointer, or the gift's value after a win. */
function setHub(lbl, main, sub, kind) {
  const won = kind === 'won', M = $('hubMain'), S = $('hubSub');
  $('hubLabel').textContent = lbl;
  M.textContent = main; M.setAttribute('y', won ? 8 : 13); M.setAttribute('font-size', won ? 40 : 36);
  S.textContent = sub; S.setAttribute('y', won ? 31 : 35);
  S.setAttribute('fill', kind === 'cta' ? '#ee292f' : won ? '#5c6672' : '#084e91');
  S.setAttribute('letter-spacing', won ? 1.6 : 1);
  S.setAttribute('font-size', hubSize(sub, won ? 11.5 : 12.5).toFixed(1));
}
const readyHub = () => setHub('SET TO', `${Math.round(angToF(ang))}°`, 'TAP TO TURN', 'cta');
function wonHub(gift) { setHub('', `$${gift.value}`, gift.short.replace(/^\$\d+\s*/, ''), 'won'); }
const zoneAt = (a) => { a = Math.max(A0, Math.min(A1 - 0.001, a)); return segs.find((s) => a >= s.a0 && a < s.a1) || segs[0]; };
function light(seg) {
  segs.forEach((s) => s.g.classList.toggle('is-lit', s === seg));
  $('tag').style.opacity = seg && seg.gift.id !== MEM ? 0.28 : 1;   // the tag dims with its slice
}
function setAng(a, live) {
  ang = a;
  $('marker').setAttribute('transform', `rotate(${a})`);
  if (live) {
    const f = Math.round(angToF(a)), seg = zoneAt(a);
    if (f !== lastF) { lastF = f; tick(1400 + (f - 50) * 12); }
    light(seg);
    setHub('SET TO', `${f}°`, seg.gift.short, 'gift');
  }
}
/** Somewhere inside one of the gift's slices, never on an edge, so the readout always names the gift it shows. */
function targetFor(giftId) {
  const mine = segs.filter((s) => s.gift.id === giftId), tot = mine.reduce((n, s) => n + (s.a1 - s.a0), 0);
  let r = Math.random() * tot, s = mine[0];
  for (const x of mine) { if ((r -= x.a1 - x.a0) < 0) { s = x; break; } }
  return s.a0 + (s.a1 - s.a0) * (0.25 + Math.random() * 0.5);
}

/* ---------------- the screen: wake → ready → heating → won → code ---------------- */
const fmtTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const shortDate = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
const longDate = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

function devState(s) {
  $('dev').dataset.state = s;
  const p = $('pill');
  if (s === 'heating') { $('dev').dataset.mode = ''; hvac('heat'); }
  else if (s === 'won') { p.className = 'arrd-pill hold'; p.innerHTML = `${icon('clock')}Hold <span data-arrd="clock">${DIAL.holdMinutes}:00</span>`; }
  else if (s === 'wake') { p.className = 'arrd-pill sub'; p.textContent = `Heat ${Math.round(angToF(ang))}°`; }
  else { p.className = 'arrd-pill'; p.textContent = fmtTime(new Date()).split(' ')[0]; }
}
/* While it turns: HEATING in red as the needle climbs, COOLING in blue as it falls, like a real thermostat. */
function hvac(mode) {
  if ($('dev').dataset.mode === mode) return;
  $('dev').dataset.mode = mode;
  const p = $('pill');
  p.className = `arrd-pill ${mode}`;
  p.innerHTML = mode === 'cool' ? `${icon('flake')}Cooling` : `${icon('flame')}Heating`;
}
function paintClock() {
  const d = new Date(), [hm, ampm] = fmtTime(d).split(' ');
  $('wkTime').textContent = hm; $('wkAmpm').textContent = ampm || '';
  $('wkDate').textContent = longDate(d);
  const st = $('dev').dataset.state;
  if (st === 'ready' || st === 'code') $('pill').textContent = hm;
  renderWeather();
}
function renderWeather() {
  const d = new Date(), w = WX;
  if (w) {
    $('wx1').innerHTML = `${icon(w.icon)}<b>${w.tempF}°F</b>${w.text ? `<span>${esc(w.text)}</span>` : ''}`;
    $('wx2').textContent = [w.humidity != null ? `Humidity ${w.humidity}%` : '', shortDate(d), w.place || ''].filter(Boolean).join(' · ');
  } else { $('wx1').textContent = longDate(d); $('wx2').textContent = ''; }
  const tiles = [];
  if (w) tiles.push(['cloud', `${w.tempF}°`, 'Outside', w.icon]);
  if (w && w.humidity != null) tiles.push(['drop', `${w.humidity}%`, 'Humidity', 'drop']);
  tiles.push(['heat', `${Math.round(angToF(ang))}°`, 'Heat set', 'flame']);
  $('tiles').innerHTML = tiles.map(([cls, v, l, ic]) => `<div class="arrd-tile ${cls}">${icon(ic)}<b>${v}</b><span>${l}</span></div>`).join('');
}
let wxReq = null;
function loadWeather() {
  wxReq ||= api('weather').then((w) => { if (w && w.ok && Number.isFinite(w.tempF)) { WX = w; renderWeather(); } }).catch(() => { wxReq = null; });
}
function setMuted(m) {
  muted = m; store.set({ muted: m });
  const b = $('mute'); b.setAttribute('aria-pressed', String(m)); b.innerHTML = icon(m ? 'mute' : 'sound');
}

/* ---------------- sound: quiet thermostat clicks, only after the visitor's own tap, and never when muted ---------------- */
function audio() { if (muted) return null; try { ac = ac || new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)(); } catch (e) { ac = null; } return ac; }
function tick(freq) {
  const c = ac; if (!c || muted) return;
  try { const o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.035, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.03);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 0.035); } catch (e) {}
}
function chime() {
  const c = ac; if (!c || muted) return;
  try { [660, 880, 1320].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * 0.09;
    o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.4); }); } catch (e) {}
}

/* ---------------- the turn: heat stop, cool stop, settle (no overshoot, so the readout never shows a gift it didn't land on) ---------------- */
const easeIO = (k) => -(Math.cos(Math.PI * k) - 1) / 2;
const easeOut = (k) => 1 - Math.pow(1 - k, 4);
const tween = (from, to, dur, ease) => new Promise((res) => {
  if (to !== from) hvac(to > from ? 'heat' : 'cool');
  const t0 = performance.now();
  (function f(now) { const k = Math.min(1, (now - t0) / dur); setAng(from + (to - from) * ease(k), true); k < 1 ? requestAnimationFrame(f) : res(); })(t0);
});
async function turnTo(giftId) {
  if (!segs.some((s) => s.gift.id === giftId)) return;
  const target = targetFor(giftId);
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
function renderScarcity(st) { $('scar').textContent = scarcityLine(st); }
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
  $('playTop').hidden = name !== 'play';
  $('dev').hidden = name === 'msg';
  $('dev').classList.toggle('is-small', name === 'claim' || name === 'done');
  if (name !== 'claim') stopClock();
  if (name !== 'play') clearTimeout(wakeTimer);
  $('sheet').scrollTop = 0;
}
function focusFirst(sel) { setTimeout(() => { const n = root.querySelector(sel); if (n) n.focus(); }, 60); }

/* The screen wakes on the time and weather, then shows the dial. A tap while it's waking turns it right away. */
function showPlay(wake) {
  show('play');
  const b = $('turn'); b.disabled = false; b.textContent = 'Turn the dial';
  $('playErr').textContent = '';
  light(null); readyHub();
  clearTimeout(wakeTimer);
  if (wake) { devState('wake'); wakeTimer = setTimeout(() => { if ($('dev').dataset.state === 'wake') devState('ready'); }, 1800); }
  else devState('ready');
}

function showMsg(title, text, action) {
  show('msg');
  const m = $('msg');
  m.innerHTML = `<p class="arrd-won">${esc(title)}</p><p class="arrd-sub" style="color:#221f20">${esc(text)}</p>
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
    const left = end - Date.now();
    root.querySelectorAll('[data-arrd="clock"]').forEach((c) => { c.textContent = fmtClock(left); });
    if (left <= 0) { stopClock(); if (!busy) holdExpired(); }
  };
  draw(); clock = setInterval(draw, 1000);
}
function holdExpired() {
  store.set({ hold: null });
  track('dial_hold_expired');
  showMsg('Your hold ran out', `We held your gift for ${DIAL.holdMinutes} minutes. Turn again for a new one.`, { label: 'Turn again', run: () => showPlay(false) });
}

function showClaim(hold) {
  show('claim');
  const g = GIFTS[hold.gift.id] || hold.gift, isMem = hold.gift.id === MEM;
  if (isMem && !memOpen) { memOpen = true; buildFace(); renderOdds(); }   // their own hold is what took it off the board
  if (zoneAt(ang).gift.id !== g.id && segs.some((s) => s.gift.id === g.id)) setAng(targetFor(g.id), false);   // reopened: put the pointer back on the gift
  devState('won'); light(zoneAt(ang)); wonHub(g);
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
  devState('code');
  $('code').textContent = won.code;
  $('codeGift').textContent = g.short;
  $('codeDate').textContent = `Good through ${won.expiresOn}`;
  d.innerHTML = `
    <p class="arrd-won">${returning ? 'Your gift' : 'You\'re set'}</p>
    <p class="arrd-gift">${esc(g.name)}</p>
    <button class="arrd-copy" type="button" data-arrd="copy">Copy code ${esc(won.code)}</button>
    <p class="arrd-sub" style="color:#221f20">Good through ${esc(won.expiresOn)}. Give this code when you book. It's tied to your phone number${returning ? '' : ', and we just texted it to you'}.</p>
    <a class="arrd-btn" href="tel:${TEL}" data-arrd="call">Call to book</a>
    <a class="arrd-btn ghost" href="${esc(DIAL.bookUrl)}" data-arrd="book">Book online</a>
    ${won.hasAddress ? '' : `<button class="arrd-link" type="button" data-arrd="detailsBtn" style="font-size:14px;color:#221f20">Add your address so we can book you faster</button>
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
    const b = e.currentTarget, label0 = b.textContent, done = () => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = label0; }, 1600); };
    const sel = () => { const rg = document.createRange(); rg.selectNodeContents($('code')); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); };
    try { navigator.clipboard.writeText(won.code).then(done, sel); } catch (err) { sel(); }
  });
  const btn = d.querySelector('[data-arrd="detailsBtn"]'), form = d.querySelector('[data-arrd="detailsForm"]');
  if (btn) btn.addEventListener('click', () => { btn.hidden = true; form.hidden = false; focusFirst('#arrd-first'); });
  if (form) form.addEventListener('submit', (e) => saveDetails(e, won, form));
}

/* ---------------- actions ---------------- */
async function turn() {
  if (busy) return;
  audio();   // unlock sound inside the tap
  busy = true;
  clearTimeout(wakeTimer);
  const b = $('turn'); b.disabled = true; b.textContent = 'Turning…'; $('playErr').textContent = '';
  devState('heating');
  track('dial_turn_pressed');
  let res;
  try {
    res = await api('turn', { device, token: await turnstileToken(), context: visitContext() });
  } catch (e) { res = { error: `We couldn't reach the dial. Check your connection, or call ${DIAL.phone}.` }; }
  if (!res.ok) {
    busy = false; b.disabled = false; b.textContent = 'Turn the dial';
    devState('ready'); light(null); readyHub();
    if (res.reason === 'limit') showMsg('That\'s all for today', res.error);
    else $('playErr').textContent = res.error || `Something went wrong on our end. Call ${DIAL.phone}.`;
    return;
  }
  if (res.gift.id === MEM && !memOpen) { memOpen = true; buildFace(); renderOdds(); }   // the status line was stale: show the slice it lands on
  if (!segs.some((x) => x.gift.id === res.gift.id)) { statusReq = null; await getStatus(); }   // the config changed since the dial was drawn
  await turnTo(res.gift.id);
  chime();
  devState('won'); wonHub(GIFTS[res.gift.id] || res.gift); b.textContent = 'You won';
  const hold = { turn: res.turn, gift: res.gift, heldUntil: res.heldUntil };
  store.set({ hold });
  track('dial_turned', { gift: res.gift.id });
  busy = false;
  setTimeout(() => showClaim(hold), reduce() ? 0 : 900);
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
      showMsg(res.reason === 'household' ? 'One free year per home' : 'Your hold ran out', res.error, { label: 'Turn again', run: () => showPlay(false) });
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
function focusables() {
  return [...root.querySelectorAll('button:not([disabled]),a[href],input')]
    .filter((n) => !n.closest('[hidden]') && n.offsetParent !== null && getComputedStyle(n).visibility !== 'hidden');
}
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
  paintClock(); uiClock = setInterval(paintClock, 15000);
  const s = store.get();
  if (live(s.won)) showDone(s.won, true);
  else if (live(s.hold)) showClaim(s.hold);
  else { showPlay(true); focusFirst('[data-arrd="turn"]'); }
  loadStatus(); loadWeather();
  track('dial_opened', { trigger });
}
function close() {
  if (!root || !isOpen || busy) return;
  isOpen = false; root.hidden = true; stopClock();
  clearInterval(uiClock); clearTimeout(wakeTimer);
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
  l.href = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,300..900&family=Oswald:wght@500;600&family=Inter:wght@400;500;600;700&display=swap';
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
  buildFace(); renderOdds(); renderWeather(); setMuted(muted);
  root.addEventListener('click', (e) => {
    if (e.target === root) { close(); return; }
    if (e.target.closest('[data-arrd="close"]')) { if (e.target.closest('.arrd-no')) track('dial_no_thanks'); close(); }
    if (e.target.closest('[data-arrd="call"]')) track('dial_call_clicked');
    if (e.target.closest('[data-arrd="book"]')) track('dial_book_clicked');
  });
  $('turn').addEventListener('click', turn);
  $('glass').addEventListener('click', (e) => {
    if (e.target.closest('a,button') || $('play').hidden) return;
    const st = $('dev').dataset.state;
    if (st === 'wake' || st === 'ready') turn();
  });
  $('mute').addEventListener('click', () => setMuted(!muted));
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

/* Time on the site: how long a page of it has been on screen this visit, kept in the visit's sessionStorage so it
 * carries across pages. Someone who clicks to another page 3 s into a 4 s delay sees the dial 1 s into that page; a
 * tab opened in the background starts counting when they look at it. A page always gets FIRST_LOOK_MS on screen
 * before the dial covers it. */
const FIRST_LOOK_MS = 1000;
let shownAt = null, pageMs = 0, autoTimer = 0, autoReady = false, autoRetried = false;
const sinceShown = () => (shownAt ? Date.now() - shownAt : 0);
function siteMs() {
  let ms = 0;
  try { ms = JSON.parse(sessionStorage.getItem(VISIT) || '{}').activeMs || 0; } catch (e) {}
  return ms + sinceShown();
}
function onShow() {
  if (shownAt || document.visibilityState !== 'visible') return;
  shownAt = Date.now();
  scheduleAuto();
}
function onHide() {
  clearTimeout(autoTimer);
  if (!shownAt) return;
  const ms = sinceShown(); shownAt = null; pageMs += ms;
  try {
    const s = JSON.parse(sessionStorage.getItem(VISIT) || 'null');
    if (s) { s.activeMs = (s.activeMs || 0) + ms; sessionStorage.setItem(VISIT, JSON.stringify(s)); }
  } catch (e) {}
}
function scheduleAuto(ms) {
  clearTimeout(autoTimer);
  if (!autoReady || !shownAt || !mayAutoOpen()) return;
  if (ms === undefined) ms = Math.max(CFG.delayMs - siteMs(), Math.min(CFG.delayMs, FIRST_LOOK_MS) - (pageMs + sinceShown()));
  autoTimer = setTimeout(tryAuto, Math.max(0, ms));
}
async function tryAuto() {
  if (!shownAt || !mayAutoOpen()) return;
  const st = await getStatus();
  if (!st || st.enabled === false || !shownAt) return;   // never interrupt a visitor just to say the dial is down
  if (pricingOpen() || typing()) { if (!autoRetried) { autoRetried = true; scheduleAuto(6000); } return; }
  open('auto');
}

/* The group, the side tab and the auto-open wait for /api/status: they follow the admin's settings. If it doesn't
 * answer, the bundled settings decide the group and the dial doesn't open by itself. */
async function init() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-arr-dial="open"]');
    if (t) { e.preventDefault(); open('button'); }
  });
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? onShow() : onHide()));
  addEventListener('pagehide', onHide);
  addEventListener('pageshow', onShow);   // back/forward cache
  onShow();
  let forced = false;
  try { forced = new URLSearchParams(location.search).get('dial') === '1'; } catch (e) {}
  mount();
  if (forced) { assign(); track('dial_assigned'); open('link'); return; }
  await getStatus();
  assign(); track('dial_assigned'); updateTab();
  autoReady = true; scheduleAuto();
}

window.ARRDial = { open, close, get variant() { return variant; }, reset: () => { try { localStorage.removeItem(STORE); } catch (e) {} } };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
