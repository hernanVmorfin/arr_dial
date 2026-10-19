import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOME, iconFor, parseObservation, visitorSpot, weatherAt, resetWeatherCache } from './weather.ts';

const now = new Date('2026-10-19T18:00:00Z');
const obs = (over: Record<string, unknown> = {}) => ({
  properties: {
    timestamp: '2026-10-19T17:45:00+00:00', textDescription: 'Partly Cloudy', icon: 'https://api.weather.gov/icons/land/day/sct?size=medium',
    temperature: { unitCode: 'wmoUnit:degC', value: 5 }, relativeHumidity: { unitCode: 'wmoUnit:percent', value: 61.7 }, ...over
  }
});
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/geo+json' } });
const point = { properties: { observationStations: 'https://api.weather.gov/gridpoints/LOT/67,60/stations' } };
const stationList = { features: [{ properties: { stationIdentifier: 'KLOT' } }, { properties: { stationIdentifier: 'KMDW' } }, { properties: { stationIdentifier: 'KORD' } }] };

/** A fake weather.gov: the points and stations calls answer, and `observe` decides each station's reading. */
function fakeNws(observe: (id: string) => Response) {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(url.replace('https://api.weather.gov', ''));
    if (url.includes('/points/')) return reply(point);
    if (url.endsWith('/stations')) return reply(stationList);
    return observe(url.split('/')[4]);
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

test('weather: the visitor\'s spot comes from Cloudflare, and outside the US it falls back to ARR\'s area', () => {
  assert.deepEqual(visitorSpot({ country: 'US', latitude: '32.77670', longitude: '-96.79700', city: 'Dallas' }), { lat: 32.7767, lon: -96.797, place: 'Dallas' });
  assert.deepEqual(visitorSpot({ country: 'US', latitude: '41.6', longitude: '-87.9' }), { lat: 41.6, lon: -87.9, place: null });
  assert.equal(visitorSpot({ country: 'CA', latitude: '43.65', longitude: '-79.38', city: 'Toronto' }), HOME);
  assert.equal(visitorSpot({ country: 'US' }), HOME);
  assert.equal(visitorSpot(undefined), HOME);
});

test('weather: an NWS observation becomes °F, rounded humidity and sentence-case text', () => {
  assert.deepEqual(parseObservation(obs(), now), { tempF: 41, humidity: 62, text: 'Partly cloudy', icon: 'cloud', observedAt: '2026-10-19T17:45:00.000Z' });
  assert.equal(parseObservation(obs({ relativeHumidity: { value: null } }), now)!.humidity, null);
  assert.equal(parseObservation(obs({ textDescription: '' }), now)!.text, null);
});

test('weather: no temperature, or a reading over 3 hours old, is no reading', () => {
  assert.equal(parseObservation(obs({ temperature: { value: null } }), now), null);
  assert.equal(parseObservation(obs({ timestamp: '2026-10-19T14:30:00+00:00' }), now), null);
  assert.equal(parseObservation({}, now), null);
});

test('weather: NWS icon names map to the screen icons', () => {
  const u = (s: string) => `https://api.weather.gov/icons/land/${s}?size=medium`;
  assert.equal(iconFor(u('day/skc')), 'sun');
  assert.equal(iconFor(u('night/few')), 'moon');
  assert.equal(iconFor(u('day/ovc')), 'cloud');
  assert.equal(iconFor(u('day/rain_showers,40')), 'rain');
  assert.equal(iconFor(u('night/rain_snow')), 'snow');
  assert.equal(iconFor(u('day/tsra_sct,60')), 'storm');
  assert.equal(iconFor(u('day/wind_few')), 'wind');
  assert.equal(iconFor(null), 'cloud');
});

test('weather: nearest station first, the next one when it has no reading, then cached for 30 minutes', async () => {
  resetWeatherCache();
  const { calls, fetcher } = fakeNws((id) => (id === 'KLOT' ? reply({}, 500) : reply(obs({ temperature: { value: 10 } }))));
  const spot = { lat: 41.6303, lon: -87.8539, place: 'Orland Park' };
  const quiet = console.error; console.error = () => {};
  try {
    assert.equal((await weatherAt(spot, fetcher, now))!.tempF, 50);
    assert.deepEqual(calls, ['/points/41.6,-87.9', '/gridpoints/LOT/67,60/stations', '/stations/KLOT/observations/latest', '/stations/KMDW/observations/latest']);
    await weatherAt({ ...spot, lat: 41.61 }, fetcher, new Date(now.getTime() + 29 * 60e3));   // same ~10 km square
    assert.equal(calls.length, 4);
    await weatherAt(spot, fetcher, new Date(now.getTime() + 31 * 60e3));   // stale reading; the station list is still good
    assert.deepEqual(calls.slice(4), ['/stations/KLOT/observations/latest', '/stations/KMDW/observations/latest']);
  } finally { console.error = quiet; }
});

test('weather: when nothing answers it returns null and waits 5 minutes before asking again', async () => {
  resetWeatherCache();
  let n = 0;
  const fetcher = (async () => { n++; throw new Error('offline'); }) as unknown as typeof fetch;
  const quiet = console.error; console.error = () => {};
  try {
    assert.equal(await weatherAt(HOME, fetcher, now), null);
    await weatherAt(HOME, fetcher, new Date(now.getTime() + 4 * 60e3));
    assert.equal(n, 1);
    await weatherAt(HOME, fetcher, new Date(now.getTime() + 6 * 60e3));
    assert.equal(n, 2);
  } finally { console.error = quiet; }
});
