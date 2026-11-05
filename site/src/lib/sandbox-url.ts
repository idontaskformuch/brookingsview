/** Broomfield's AgendaLink `agendaUrl` (copied verbatim into meetings.agenda_url
 *  and, at publish time, into stories.source_url -- see publish.py's
 *  build_source_url()) comes back from the vendor's own API pointing at
 *  sandbox.agendalink.app, not a horizon.agendalink.app/production host --
 *  confirmed 2026-08-27 this is the API's OWN returned field, not something
 *  this codebase guesses or constructs. Whether that host is genuinely
 *  Broomfield's real public portal (oddly named) or a non-production
 *  environment couldn't be confirmed live (2026-09-30: the page is a
 *  JS-rendered SPA a text fetch can't evaluate) -- horizon.agendalink.app
 *  looks like the real production host (same meeting IDs are Google-indexed
 *  there), but that's one coincidental match, not a verified rewrite rule,
 *  so this doesn't guess at a replacement URL. Given the uncertainty, no
 *  outbound link on this site should point at sandbox.* -- see every call
 *  site of this function for the fallback used instead. */
export function isSandboxUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.startsWith('sandbox.');
  } catch {
    return false;
  }
}

