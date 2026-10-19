/* Outside weather for the thermostat screen, where the visitor is. Cloudflare already estimates every request's
 * city from its IP (request.cf), so there is no location prompt; the spot is used for this one lookup and never stored.
 * The reading is the latest National Weather Service observation from the closest station: free, no key, public
 * data, and NWS asks for a User-Agent that says who is calling. NWS covers the US only, so a visitor outside it (or
 * one Cloudflare can't place) gets ARR's own area. Each Worker keeps a reading for 30 minutes per ~10 km square
 * (5 minutes after a miss) and a square's station list for a day, so NWS sees a handful of calls an hour. */

export type Spot = { lat: number; lon: number; place: string | null };
export type Weather = {
  tempF: number;
  humidity: number | null;
  text: string | null;
  icon: 'sun' | 'moon' | 'cloud' | 'rain' | 'snow' | 'storm' | 'wind';
  observedAt: string;
};

export const HOME: Spot = { lat: 41.63, lon: -87.85, place: 'Orland Park' };
const NWS = 'https://api.weather.gov';
const USER_AGENT = 'ARR Comfort Dial (alwaysreadyrepair.com, office@arrhvac.com)';
const FRESH_MS = 30 * 60e3, MISS_MS = 5 * 60e3, STATIONS_MS = 24 * 3600e3, MAX_AGE_MS = 3 * 3600e3, MAX_KEYS = 500;

/** The visitor's spot from Cloudflare's request.cf, or ARR's area when it's outside the US or unknown. */
export function visitorSpot(cf: any): Spot {
  const lat = Number(cf?.latitude), lon = Number(cf?.longitude);
  if (cf?.country !== 'US' || !cf?.latitude || !cf?.longitude || !Number.isFinite(lat) || !Number.isFinite(lon)) return HOME;
  const city = typeof cf.city === 'string' ? cf.city.trim().slice(0, 40) : '';
  return { lat, lon, place: city || null };
}

/** NWS icon URLs look like .../icons/land/night/rain_showers,40?size=medium. The first condition decides. */
export function iconFor(url: unknown): Weather['icon'] {
  const m = /\/icons\/land\/(day|night)\/([a-z_]+)/.exec(String(url || ''));
  if (!m) return 'cloud';
  const [, time, c] = m;
  if (/^(tsra|tornado|hurricane|tropical)/.test(c)) return 'storm';
  if (/snow|blizzard|sleet/.test(c)) return 'snow';
  if (/rain|fzra/.test(c)) return 'rain';
  if (/^wind_(skc|few)/.test(c)) return 'wind';
  if (/^(skc|few|hot|cold)$/.test(c)) return time === 'night' ? 'moon' : 'sun';
  return 'cloud';
}

/** "Partly Cloudy" → "Partly cloudy". Empty text stays empty; the screen then shows the temperature alone. */
const sentence = (s: unknown) => { const t = String(s || '').trim().toLowerCase(); return t ? t[0].toUpperCase() + t.slice(1, 40) : null; };

/** One observation → what the screen shows, or null when it's missing a temperature or is over 3 hours old. */
export function parseObservation(body: any, now = new Date()): Weather | null {
  const p = body?.properties;
  const c = p?.temperature?.value;
  if (typeof c !== 'number' || !Number.isFinite(c)) return null;
  const at = new Date(p.timestamp);
  if (!(now.getTime() - at.getTime() < MAX_AGE_MS)) return null;
  const rh = p.relativeHumidity?.value;
  return {
    tempF: Math.round(c * 9 / 5 + 32),
    humidity: typeof rh === 'number' && Number.isFinite(rh) ? Math.round(rh) : null,
    text: sentence(p.textDescription),
    icon: iconFor(p.icon),
    observedAt: at.toISOString()
  };
}

const readings = new Map<string, { at: number; data: Weather | null }>();
const stations = new Map<string, { at: number; ids: string[] }>();
const pending = new Map<string, Promise<Weather | null>>();
const remember = <V>(m: Map<string, V>, k: string, v: V) => { if (m.size >= MAX_KEYS) m.clear(); m.set(k, v); };

async function getJson(fetcher: typeof fetch, url: string) {
  const res = await fetcher(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/geo+json' }, signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`weather.gov ${res.status} ${url}`);
  return res.json() as Promise<any>;
}

/** The closest observation stations to a ~10 km square, nearest first (NWS sorts them). */
async function stationsFor(key: string, fetcher: typeof fetch, now: Date) {
  const known = stations.get(key);
  if (known && now.getTime() - known.at < STATIONS_MS) return known.ids;
  const point = await getJson(fetcher, `${NWS}/points/${key}`);
  const url = point?.properties?.observationStations;
  if (typeof url !== 'string' || !url.startsWith(`${NWS}/`)) throw new Error(`weather.gov: no stations for ${key}`);
  const list = await getJson(fetcher, url);
  const ids = (Array.isArray(list?.features) ? list.features : [])
    .map((f: any) => f?.properties?.stationIdentifier).filter((s: unknown) => typeof s === 'string' && /^[A-Z0-9]{3,6}$/.test(s)).slice(0, 2);
  if (!ids.length) throw new Error(`weather.gov: empty station list for ${key}`);
  remember(stations, key, { at: now.getTime(), ids });
  return ids as string[];
}

export async function weatherAt(spot: Spot, fetcher: typeof fetch = fetch, now = new Date()): Promise<Weather | null> {
  const key = `${spot.lat.toFixed(1)},${spot.lon.toFixed(1)}`;
  const hit = readings.get(key);
  if (hit && now.getTime() - hit.at < (hit.data ? FRESH_MS : MISS_MS)) return hit.data;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const job = (async () => {
    let data: Weather | null = null;
    try {
      for (const id of await stationsFor(key, fetcher, now)) {
        try { if ((data = parseObservation(await getJson(fetcher, `${NWS}/stations/${id}/observations/latest`), now))) break; }
        catch (e) { console.error('dial weather', id, String(e)); }
      }
    } catch (e) { console.error('dial weather', String(e)); }
    remember(readings, key, { at: now.getTime(), data });
    return data;
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

/** Tests only: forget every cached reading and station list. */
export const resetWeatherCache = () => { readings.clear(); stations.clear(); pending.clear(); };
