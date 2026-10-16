/* Address normalization, copied from the pricing app (packages/county/src/normalize.ts) so the key matches the
 * `normalized_key` column of Supabase `property_addresses` exactly. Change one, change both.
 * ("14612 Maple Ln", "60462") → '14612 MAPLE LN|60462'. */
const SUFFIX: Record<string, string> = { STREET: 'ST', AVENUE: 'AVE', LANE: 'LN', DRIVE: 'DR', ROAD: 'RD', COURT: 'CT', PLACE: 'PL', BOULEVARD: 'BLVD', TERRACE: 'TER', CIRCLE: 'CIR', TRAIL: 'TRL', PARKWAY: 'PKWY', HIGHWAY: 'HWY', SQUARE: 'SQ', CRESCENT: 'CRES', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };

export function addressKey(street: string, zip: string): string {
  const line1 = (street.split(',')[0] || '').trim().toUpperCase().replace(/[.#]/g, '').replace(/\s+/g, ' ');
  const tokens = line1.split(' ').map((t) => SUFFIX[t] || t);
  const number = tokens[0] || '';
  const rest = tokens.slice(1).filter((t) => !/^(APT|UNIT|STE)$/.test(t)).join(' ');
  return `${`${number} ${rest}`.trim()}|${zip}`.replace(/\s+/g, ' ');
}
