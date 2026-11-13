/** Old events have no page (site/src/lib/old-events.ts), so a request for one is a 404 from the static assets. Instead of
 *  the 404 the Worker sends a permanent redirect to the archive, where the event is still listed (owner 2026-10-28).
 *  Only /s/event-<number>/ is touched that way. A missing series page (/s/event-series-<hash>/) is a series from a frozen source
 *  past its window (site/src/lib/frozen-sources.mjs) -- it may come back, so a temporary 302 to /events/ (owner 2026-11-13). */
export const PRUNED_EVENT_TARGET = '/events/past/';
export const HIDDEN_SERIES_TARGET = '/events/';

const EVENT_PATH = /^\/s\/event-\d+\/?$/;
const SERIES_PATH = /^\/s\/event-series-[0-9a-f]+\/?$/;

export const isEventPermalink = (pathname: string): boolean => EVENT_PATH.test(pathname);
export const isSeriesPermalink = (pathname: string): boolean => SERIES_PATH.test(pathname);

/** Serve the asset if it exists; if an event permalink is missing, 301 to the archive; a missing series, 302 to /events/. */
export async function withPrunedEventRedirect(
  request: Request, fetchAsset: (r: Request) => Promise<Response>,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!(request.method === 'GET' || request.method === 'HEAD')) return null;
  const series = isSeriesPermalink(url.pathname);
  if (!series && !isEventPermalink(url.pathname)) return null;
  const res = await fetchAsset(request);
  if (res.status !== 404) return res;
  return series
    ? Response.redirect(new URL(HIDDEN_SERIES_TARGET, url.origin).toString(), 302)
    : Response.redirect(new URL(PRUNED_EVENT_TARGET, url.origin).toString(), 301);
}

/** A merged occurrence (event-series-redirects.json) whose series is built: the existing 301 to the series, unchanged. Whose series
 *  is hidden (no page): 302 to /events/, the same as a request for the series itself. */
export async function mergedOccurrenceRedirect(
  request: Request, seriesPath: string, fetchAsset: (r: Request) => Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL(seriesPath, url.origin);
  if (isSeriesPermalink(target.pathname)) {
    const series = await fetchAsset(new Request(target.toString(), { method: 'GET' }));
    if (series.status === 404) return Response.redirect(new URL(HIDDEN_SERIES_TARGET, url.origin).toString(), 302);
  }
  target.search = url.search;
  return Response.redirect(target.toString(), 301);
}
