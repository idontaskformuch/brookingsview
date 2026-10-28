/** Old events have no page (site/src/lib/old-events.ts), so a request for one is a 404 from the static assets. Instead of
 *  the 404 the Worker sends a permanent redirect to the archive, where the event is still listed (owner 2026-10-28).
 *  Only /s/event-<number>/ is touched; series and everything else keep their normal behaviour. */
export const PRUNED_EVENT_TARGET = '/events/past/';

const EVENT_PATH = /^\/s\/event-\d+\/?$/;

export const isEventPermalink = (pathname: string): boolean => EVENT_PATH.test(pathname);

/** Serve the asset if it exists; if an event permalink is missing, 301 to the archive. */
export async function withPrunedEventRedirect(
  request: Request, fetchAsset: (r: Request) => Promise<Response>,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!(request.method === 'GET' || request.method === 'HEAD') || !isEventPermalink(url.pathname)) return null;
  const res = await fetchAsset(request);
  if (res.status !== 404) return res;
  return Response.redirect(new URL(PRUNED_EVENT_TARGET, url.origin).toString(), 301);
}
