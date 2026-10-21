/** Read-only Clarity fetching. Polls current_ver.txt (tiny) and only downloads data when the version
 *  changed. The host publishes no robots/terms and its CDN rejects UA-less requests, so we always
 *  identify as ViewMediaBot. Keep polling to <= once per 5 min on election night. */
import { unzipSync, strFromU8 } from 'fflate';
import { inspectCountyElections, parseClarityDetail, parseClaritySummary, type ClarityDetail, type CountyFeed } from '../adapters/clarity';
import type { Contest } from '../types';

export const CLARITY_USER_AGENT = 'ViewMediaBot (+https://broomfieldview.com/contact)';
const HOST = 'https://results.enr.clarityelections.com';
export const COLORADO_STATE_JUNE_2026 = `${HOST}/CO/126592`;

const get = async (f: typeof fetch, url: string): Promise<Response> => {
  const r = await f(url, { headers: { 'User-Agent': CLARITY_USER_AGENT } });
  if (!r.ok) throw new Error(`clarity: GET ${url} -> ${r.status}`);
  return r;
};

/** `eventBase` is https://results.enr.clarityelections.com/<state>/<event id>  (no trailing slash). */
export async function currentVersion(eventBase: string, f: typeof fetch = fetch): Promise<string> {
  const v = (await (await get(f, `${eventBase}/current_ver.txt`)).text()).trim();
  if (!/^\d+$/.test(v)) throw new Error(`clarity: current_ver.txt is not a version number: "${v.slice(0, 40)}"`);
  return v;
}

export interface ClarityFetch {
  version: string;
  sourceUrl: string;
  rawSummary: string;
  contests: Contest[];
  detail: ClarityDetail;
}

export async function fetchClarity(eventBase: string, f: typeof fetch = fetch): Promise<ClarityFetch> {
  const version = await currentVersion(eventBase, f);
  const rawSummary = await (await get(f, `${eventBase}/${version}/json/en/summary.json`)).text();
  const zip = new Uint8Array(await (await get(f, `${eventBase}/${version}/reports/detailxml.zip`)).arrayBuffer());
  const entry = unzipSync(zip)['detail.xml'];
  if (!entry) throw new Error('clarity: detailxml.zip has no detail.xml');
  return {
    version,
    sourceUrl: `${eventBase}/${version}/`,
    rawSummary,
    contests: parseClaritySummary(rawSummary),
    detail: parseClarityDetail(strFromU8(entry)),
  };
}

/** Broomfield's own Clarity site: "empty" until the county publishes something. */
export async function checkBroomfieldCountyFeed(expectedElectionDate: string, f: typeof fetch = fetch): Promise<CountyFeed> {
  const json = await (await get(f, `${HOST}/CO/Broomfield/elections.json`)).text();
  return inspectCountyElections(json, expectedElectionDate);
}

/** Colorado's November event id is NOT guessed: it is read from the SoS ENR page, then the caller must
 *  confirm detail.xml's ElectionDate matches (a stale link to June's event is therefore refused). */
export async function resolveColoradoStateEvent(f: typeof fetch = fetch): Promise<string | null> {
  const r = await f('https://www.sos.state.co.us/pubs/elections/Results/ENR/countyLevelResults.html', {
    headers: { 'User-Agent': CLARITY_USER_AGENT },
  });
  if (!r.ok) throw new Error(`clarity: SoS ENR page -> ${r.status}`);
  const id = /results\.enr\.clarityelections\.com\/CO\/(\d+)\//.exec(await r.text())?.[1];
  return id ? `${HOST}/CO/${id}` : null;
}
