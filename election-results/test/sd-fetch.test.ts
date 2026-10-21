import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countyTargets, fetchSdCounty, hiddenFields } from '../src/fetch/sd';

const xlsx = readFileSync(new URL('./fixtures/sd-brookings-2026-06-primary.xlsx', import.meta.url));

const PAGE = (date: string) => `<html><span>Results last updated: 6/3/2026 1:05 AM CT</span>
<input type="hidden" name="__VIEWSTATE" value="abc+/=&amp;x" />
<input type="hidden" name="ctl00$hidElectionDate" id="d" value="${date}" />
<div><a onclick="DownloadFile();" href="javascript:__doPostBack(&#39;ctl00$MainContent$ctl12&#39;,&#39;&#39;)">Brookings</a></div>
<div><a onclick="DownloadFile();" href="javascript:__doPostBack(&#39;ctl00$MainContent$ctl14&#39;,&#39;&#39;)">Brown</a></div></html>`;

function fakeFetch(date: string, calls: Array<{ url: string; init?: RequestInit }> = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (!init?.method) return new Response(PAGE(date), { status: 200 });
    return new Response(xlsx, {
      status: 200,
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    });
  }) as unknown as typeof fetch;
}

describe('sd page parsing', () => {
  it('decodes hidden fields and county postback targets', () => {
    expect(hiddenFields(PAGE('6/2/2026'))['__VIEWSTATE']).toBe('abc+/=&x');
    expect(countyTargets(PAGE('6/2/2026')).get('Brookings')).toBe('ctl00$MainContent$ctl12');
  });
});

describe('fetchSdCounty', () => {
  it('posts the county target with the page fields and parses the workbook', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const r = await fetchSdCounty({ county: 'Brookings', expectedElectionDate: '2026-06-02', eid: 773, fetchImpl: fakeFetch('6/2/2026', calls) });
    expect(r.electionDate).toBe('2026-06-02');
    expect(r.sourceUpdatedAt).toBe('6/3/2026 1:05 AM CT');
    expect(r.workbook.contests).toHaveLength(11);
    const post = calls[1].init!;
    const body = new URLSearchParams(String(post.body));
    expect(body.get('__EVENTTARGET')).toBe('ctl00$MainContent$ctl12');
    expect(body.get('__VIEWSTATE')).toBe('abc+/=&x');
    expect((post.headers as Record<string, string>)['User-Agent']).toMatch(/^ViewMediaBot/);
  });
  it('refuses a page that serves a different election than expected', async () => {
    await expect(fetchSdCounty({ county: 'Brookings', expectedElectionDate: '2026-11-03', fetchImpl: fakeFetch('6/2/2026') }))
      .rejects.toThrow(/refusing/);
  });
  it('fails loudly when the county link is missing', async () => {
    await expect(fetchSdCounty({ county: 'Nowhere', expectedElectionDate: '2026-06-02', fetchImpl: fakeFetch('6/2/2026') }))
      .rejects.toThrow(/no export link/);
  });
  it('rejects a non-XLSX answer', async () => {
    const f = (async (_u: string, init?: RequestInit) =>
      init?.method ? new Response('<html>err</html>', { headers: { 'content-type': 'text/html' } }) : new Response(PAGE('6/2/2026'))) as unknown as typeof fetch;
    await expect(fetchSdCounty({ county: 'Brookings', expectedElectionDate: '2026-06-02', fetchImpl: f })).rejects.toThrow(/not an XLSX/);
  });
});
