/** GA4 measurement ids. A town whose property does not exist yet carries GA4_PLACEHOLDER; ga4IdProblem() says why an id may not be built with,
 *  and BaseLayout throws on it, so a placeholder can never reach production (owner 2026-11-24). Real ids are "G-" + 8-12 capital letters/digits. */
export const GA4_PLACEHOLDER = 'G-PLACEHOLDER';

export function ga4IdProblem(id: string | undefined): string | null {
  if (id === undefined) return null; // no GA4 for this town: nothing is rendered
  if (id === GA4_PLACEHOLDER) return 'it is still the placeholder; put the real G-ID of the town\'s own GA4 property in site-config.ts';
  if (!/^G-[A-Z0-9]{8,12}$/.test(id)) return `"${id}" is not a GA4 measurement id (G- followed by 8-12 capital letters or digits)`;
  return null;
}

/** Towns where analytics needs the visitor's opt-in first (PECR/UK GDPR): GA4 loads only after "Accept". The others keep the opt-out gate. */
export function ga4NeedsOptIn(country: string): boolean {
  return country === 'gb';
}
