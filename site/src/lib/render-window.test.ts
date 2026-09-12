import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { isWithinRenderWindow } from './render-window';
import type { RenderWindow } from './site-config';

function configWith(overrides: Partial<RenderWindow>) {
  return { renderWindow: { homeSales: null, meetings: null, events: null, ...overrides } };
}

describe('isWithinRenderWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders everything when the window is null -- Phase 1 no-op guarantee', () => {
    const config = configWith({ homeSales: null });
    expect(isWithinRenderWindow('2010-01-01', 'homeSales', config)).toBe(true);
    expect(isWithinRenderWindow(null, 'homeSales', config)).toBe(true);
  });

  it('excludes a record older than the configured window', () => {
    const config = configWith({ homeSales: 12 });
    expect(isWithinRenderWindow('2024-01-01', 'homeSales', config)).toBe(false);
  });

  it('includes a record inside the configured window', () => {
    const config = configWith({ homeSales: 12 });
    expect(isWithinRenderWindow('2026-08-01', 'homeSales', config)).toBe(true);
  });

  it('accepts a real Date object, not just a string', () => {
    const config = configWith({ events: 3 });
    expect(isWithinRenderWindow(new Date('2026-09-01'), 'events', config)).toBe(true);
    expect(isWithinRenderWindow(new Date('2025-01-01'), 'events', config)).toBe(false);
  });

  // "Never silently drop a record with an unknown date" -- a missing date
  // is a data-quality gap, not evidence of age.
  it('always renders a record with no date at all, even with a window configured', () => {
    const config = configWith({ meetings: 6 });
    expect(isWithinRenderWindow(null, 'meetings', config)).toBe(true);
    expect(isWithinRenderWindow(undefined, 'meetings', config)).toBe(true);
  });

  it('reads each page type\'s own window independently', () => {
    const config = configWith({ homeSales: 12, meetings: null, events: 3 });
    // Same old date: excluded under homeSales' 12mo window...
    expect(isWithinRenderWindow('2024-01-01', 'homeSales', config)).toBe(false);
    // ...but meetings has no window, so the identical date still renders.
    expect(isWithinRenderWindow('2024-01-01', 'meetings', config)).toBe(true);
    // ...and events' tighter 3mo window excludes it too.
    expect(isWithinRenderWindow('2024-01-01', 'events', config)).toBe(false);
  });
});
