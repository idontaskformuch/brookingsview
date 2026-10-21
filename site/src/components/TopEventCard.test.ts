import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import TopEventCard from './TopEventCard.astro';

describe('TopEventCard', () => {
  const story = {
    id: 3941, title: '114th Hobo Day', slug: 'hobo-day-114', occurs_at: '2026-10-24T05:00:00Z', ends_at: null,
    venue_raw: 'Downtown Brookings',
  };
  it('shows the event with its town-local date and hides itself via data-start once over', async () => {
    const c = await AstroContainer.create();
    const html = await c.renderToString(TopEventCard, { props: { story, timezone: 'America/Chicago' } });
    expect(html).toContain('114th Hobo Day');
    expect(html).toContain('Saturday, October 24');
    expect(html).toContain('Downtown Brookings');
    expect(html).toMatch(/date-badge__mon[^>]*>OCT</);
    expect(html).toContain('data-hide-ended');
    expect(html).toContain('data-hide-when-empty');
    expect(html).toContain('data-start="2026-10-24T05:00:00.000Z"');
  });
});
