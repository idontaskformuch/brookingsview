import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import PopEventList from '../components/pop/PopEventList.astro';
import { isExternalHref } from './event-pop';
import { siteConfig } from './site-config';
import type { PopDay, PopRow } from './pop-days';

// Owner 2026-11-09: links in the date-tile list that leave the site open in a new tab with rel="noopener"; links inside the site are left alone.
const row = (title: string, href: string): PopRow => ({ dayKey: '2026-11-13', timeLabel: '', title, venue: null, area: null, free: false, kids: false, teens: false, cat: null, start: '2026-11-14T01:00:00Z', end: null, recurrence: 'one_off', href });
const render = async (days: PopDay[]) => (await AstroContainer.create()).renderToString(PopEventList, { props: { days, keepOver: true } });
const anchor = (html: string, title: string) => html.split('<a ').find((c) => c.includes(title))?.split('>')[0] ?? '';

describe('external links in PopEventList', () => {
  it('an absolute link to another site has target=_blank and rel=noopener; a relative link and an own-domain link have neither', async () => {
    const html = await render([{ dayKey: '2026-11-13', rows: [row('Away', 'https://example.org/e'), row('Inside', '/s/inside/'), row('Own', `${siteConfig.siteUrl}/s/own/`)] }]);
    expect(anchor(html, 'Away')).toMatch(/target="_blank"/);
    expect(anchor(html, 'Away')).toMatch(/rel="noopener"/);
    for (const t of ['Inside', 'Own']) expect(anchor(html, t), t).not.toMatch(/target=|rel=/);
  });
  it('isExternalHref: www and case do not matter, junk is internal', () => {
    expect(isExternalHref('https://WWW.brookingsview.com/x', 'brookingsview.com')).toBe(false);
    expect(isExternalHref('https://other.com/', 'brookingsview.com')).toBe(true);
    expect(isExternalHref('mailto:a@b.c', 'brookingsview.com')).toBe(false);
    expect(isExternalHref(undefined, 'brookingsview.com')).toBe(false);
  });
});
