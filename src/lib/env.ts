/* Webflow Cloud's dashboard preserves whatever case a variable was typed in, so a key entered as `supabase_url`
 * lands on the Worker under exactly that name (the pricing app lost days to this). Look names up case-insensitively. */
export function envVar(env: unknown, name: string): string | undefined {
  const e = (env || {}) as Record<string, unknown>;
  const direct = e[name];
  if (typeof direct === 'string' && direct) return direct;
  const want = name.toLowerCase();
  for (const k of Object.keys(e)) {
    if (k.toLowerCase() !== want) continue;
    const v = e[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}
