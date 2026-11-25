/** Who a source link credits, by host. A listing taken from a publisher's own calendar names that
 *  publisher on the story page ("Source: City and County of Broomfield -- the original listing"),
 *  not just a bare link. Hosts not listed keep the generic wording. */
const CREDITS: Record<string, string> = {
  'broomfield.org': 'City and County of Broomfield',
  'compass.broomfield.org': 'Broomfield Library (Compass)',
  'glasgowlife.org.uk': 'Glasgow Life',
};

/** Who owns the site a place's source_url points to. A facility page's "Source" link names that owner, never the town by
 *  default: McCrory Gardens' source is SDSU's page, not the City's (owner order 2026-11-25, punkt 2; QA
 *  web.place-source-owner). A host matches itself or any subdomain. Hosts not listed show the bare host name. */
const SITE_OWNERS: Record<string, string> = {
  'cityofbrookings-sd.gov': 'City of Brookings website',
  'sdstate.edu': 'South Dakota State University (SDSU) website',
  'broomfield.org': 'City and County of Broomfield website',
  'moval.org': 'City of Moreno Valley website',
  'moval.gov': 'City of Moreno Valley website',
  'wikipedia.org': 'Wikipedia',
};

export function sourceOwnerLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return url;
  }
  for (const [domain, owner] of Object.entries(SITE_OWNERS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return owner;
  }
  return host;
}

export function sourceCreditName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return CREDITS[host] ?? null;
  } catch {
    return null;
  }
}
