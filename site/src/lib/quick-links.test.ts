import { describe, expect, it } from 'vitest';
import { resolveQuickLinks, type QuickLinkContext } from './quick-links';

const EMPTY_CTX: QuickLinkContext = {
  hasToday: false, hasWeekend: false, hasFree: false, hasKids: false,
  hasLibrary: false, hasJackrabbits: false, hasMeetings: false,
  hasClosures: false, hasJobs: false, hasTraffic: false, hasWhatsOn: false,
  hasFacilities: false,
};

describe('resolveQuickLinks', () => {
  it('an entry with an empty target produces no chip, and is listed as omitted (build log line)', () => {
    const result = resolveQuickLinks('brookings_sd', { ...EMPTY_CTX, hasLibrary: false, hasJackrabbits: true });
    expect(result.shown.find((s) => s.label === 'Library')).toBeUndefined();
    expect(result.omitted).toContain('Library');
  });

  it('never links to an empty page -- omitted entries carry no route into `shown`', () => {
    const result = resolveQuickLinks('moreno_valley_ca', EMPTY_CTX);
    expect(result.shown).toEqual([]);
    expect(result.omitted.length).toBeGreaterThan(0);
  });

  it('"Things to do" points to /events/today/ when today has content', () => {
    const result = resolveQuickLinks('brookings_sd', { ...EMPTY_CTX, hasToday: true });
    expect(result.shown[0]).toEqual({ label: 'Things to do', route: '/events/today/' });
  });

  it('"Things to do" falls back to /events/this-weekend/ when only the weekend has content', () => {
    const result = resolveQuickLinks('brookings_sd', { ...EMPTY_CTX, hasWeekend: true });
    expect(result.shown[0]).toEqual({ label: 'Things to do', route: '/events/this-weekend/' });
  });

  it('"Things to do" is omitted entirely when neither today nor the weekend has content', () => {
    const result = resolveQuickLinks('brookings_sd', EMPTY_CTX);
    expect(result.shown.find((s) => s.label === 'Things to do')).toBeUndefined();
    expect(result.omitted).toContain('Things to do');
  });

  it('shows at most 7, even if every candidate passes', () => {
    const fullCtx: QuickLinkContext = {
      hasToday: true, hasWeekend: true, hasFree: true, hasKids: true,
      hasLibrary: true, hasJackrabbits: true, hasMeetings: true,
      hasClosures: true, hasJobs: true, hasTraffic: true, hasWhatsOn: true,
      hasFacilities: true,
    };
    const result = resolveQuickLinks('brookings_sd', fullCtx);
    expect(result.shown.length).toBeLessThanOrEqual(7);
  });

  it('Broomfield never shows Brookings/Moreno-Valley-only items (Jackrabbits, Kids & family)', () => {
    const fullCtx: QuickLinkContext = {
      hasToday: true, hasWeekend: true, hasFree: true, hasKids: true,
      hasLibrary: true, hasJackrabbits: true, hasMeetings: true,
      hasClosures: true, hasJobs: true, hasTraffic: true, hasWhatsOn: true,
      hasFacilities: true,
    };
    const result = resolveQuickLinks('broomfield_co', fullCtx);
    expect(result.shown.map((s) => s.label)).not.toContain('Jackrabbits');
    expect(result.shown.map((s) => s.label)).not.toContain('Kids & family');
  });
});
