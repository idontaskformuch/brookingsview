import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import OrientationHeader from './OrientationHeader.astro';

/** QA front.orientation-date-follows-now: the front page's date line is the day of the instant the page is built for
 *  (index.astro's `now`, FRONT_PAGE_NOW in a local build), not the build machine's clock (review 2026-11-18). */
describe('OrientationHeader date', () => {
  it('follows the `now` it is given', async () => {
    const c = await AstroContainer.create();
    const html = await c.renderToString(OrientationHeader, { props: { now: new Date('2026-12-24T18:00:00Z') } });
    expect(html).toContain('data-build-date="2026-12-24"');
    expect(html).toMatch(/Thursday, Dec 24/);
  });
});
