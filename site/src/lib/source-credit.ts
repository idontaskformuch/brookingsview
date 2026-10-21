/** Who a source link credits, by host. A listing taken from a publisher's own calendar names that
 *  publisher on the story page ("Source: City and County of Broomfield -- the original listing"),
 *  not just a bare link. Hosts not listed keep the generic wording. */
const CREDITS: Record<string, string> = {
  'broomfield.org': 'City and County of Broomfield',
  'compass.broomfield.org': 'Broomfield Library (Compass)',
};

export function sourceCreditName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return CREDITS[host] ?? null;
  } catch {
    return null;
  }
}
