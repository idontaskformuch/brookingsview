import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import DateBadge from './DateBadge.astro';

async function badge(iso: string, timezone: string) {
  const c = await AstroContainer.create();
  const html = await c.renderToString(DateBadge, { props: { iso, timezone } });
  const mon = html.match(/date-badge__mon[^>]*>([^<]*)</)?.[1];
  const day = html.match(/date-badge__day[^>]*>([^<]*)</)?.[1];
  return `${mon} ${day}`;
}

describe('DateBadge', () => {
  // 2026-10-21T04:30Z is still Oct 20 evening in all three towns' zones, and
  // already Oct 21 in UTC and Stockholm -- the machine's zone must not leak in.
  it('shows the event date in the town zone, not the machine zone', async () => {
    expect(await badge('2026-10-21T04:30:00Z', 'America/Chicago')).toBe('OCT 20');
    expect(await badge('2026-10-21T04:30:00Z', 'America/Los_Angeles')).toBe('OCT 20');
    expect(await badge('2026-10-21T04:30:00Z', 'America/Denver')).toBe('OCT 20');
  });
  it('rolls over at the town midnight', async () => {
    expect(await badge('2026-10-21T05:00:00Z', 'America/Chicago')).toBe('OCT 21'); // 00:00 CDT
    expect(await badge('2026-11-01T06:30:00Z', 'America/Chicago')).toBe('NOV 1');  // inside the repeated 01:00 hour
  });
  it('is decorative: hidden from assistive tech', async () => {
    const c = await AstroContainer.create();
    const html = await c.renderToString(DateBadge, { props: { iso: '2026-10-20T20:00:00Z', timezone: 'America/Chicago' } });
    expect(html).toContain('aria-hidden="true"');
  });
});
