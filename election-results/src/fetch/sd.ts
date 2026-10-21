/** Fetches one county's XLSX from electionresults.sd.gov (ASP.NET WebForms postback).
 *  Flow: GET ResultsExport.aspx[?eid=N] -> read hidden fields + the county's __doPostBack target ->
 *  POST them back -> XLSX. Without eid the site serves the CURRENT election, so we check the page's
 *  own hidElectionDate against the date we expect and refuse anything else (never guess an election).
 *  `fetchImpl` is injected so tests (and the Worker) control the network. */
import { parseSdWorkbook, type SdWorkbook } from '../adapters/sd-xlsx';

export const SD_USER_AGENT = 'ViewMediaBot (+https://brookingsview.com/contact)';
const BASE = 'https://electionresults.sd.gov/ResultsExport.aspx';

export interface SdFetchResult {
  sourceUrl: string;
  /** The page's own "Results last updated: ... CT", or null if it printed none. */
  sourceUpdatedAt: string | null;
  electionDate: string; // ISO yyyy-mm-dd, from the page
  raw: Uint8Array;
  workbook: SdWorkbook;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function hiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/type="hidden"/i.test(tag)) continue;
    const name = /name="([^"]+)"/i.exec(tag)?.[1];
    if (!name) continue;
    out[decodeEntities(name)] = decodeEntities(/value="([^"]*)"/i.exec(tag)?.[1] ?? '');
  }
  return out;
}

/** County name -> its __doPostBack event target, e.g. "Brookings" -> "ctl00$MainContent$ctl12". */
export function countyTargets(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/__doPostBack\((?:&#39;|')([^'&]+)(?:&#39;|'),(?:&#39;|')(?:&#39;|')\)[^>]*>([^<]+)</g)) {
    out.set(decodeEntities(m[2]).trim(), decodeEntities(m[1]));
  }
  return out;
}

function pageElectionDate(fields: Record<string, string>): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(fields['ctl00$hidElectionDate'] ?? '');
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

function cookieHeader(res: Response): string {
  const raw = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

export async function fetchSdCounty(opts: {
  county: string;
  expectedElectionDate: string;
  eid?: number;
  fetchImpl?: typeof fetch;
}): Promise<SdFetchResult> {
  const f = opts.fetchImpl ?? fetch;
  const url = opts.eid ? `${BASE}?eid=${opts.eid}` : BASE;
  const headers = { 'User-Agent': SD_USER_AGENT };

  const page = await f(url, { headers });
  if (!page.ok) throw new Error(`sd: GET ${url} -> ${page.status}`);
  const html = await page.text();
  const fields = hiddenFields(html);
  const date = pageElectionDate(fields);
  if (date !== opts.expectedElectionDate) {
    throw new Error(`sd: page serves election ${date}, expected ${opts.expectedElectionDate}; refusing`);
  }
  const target = countyTargets(html).get(opts.county);
  if (!target) throw new Error(`sd: no export link for county "${opts.county}"`);

  const cookie = cookieHeader(page);
  const body = new URLSearchParams({ ...fields, __EVENTTARGET: target, __EVENTARGUMENT: '' });
  const res = await f(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) },
    body,
  });
  if (!res.ok) throw new Error(`sd: POST ${url} -> ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('spreadsheetml')) throw new Error(`sd: export returned "${type}", not an XLSX`);
  const raw = new Uint8Array(await res.arrayBuffer());

  return {
    sourceUrl: url,
    sourceUpdatedAt: /Results last updated:\s*([^<]+?)\s*</i.exec(html)?.[1] ?? null,
    electionDate: date,
    raw,
    workbook: parseSdWorkbook(raw),
  };
}
