import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { GA4_PLACEHOLDER, ga4IdProblem, ga4NeedsOptIn } from './ga4';

// GA4 for Glasgow (owner 2026-11-24): opt-in for every visitor, a way to change the choice, a placeholder the build refuses.
const layout = readFileSync(new URL('../layouts/BaseLayout.astro', import.meta.url), 'utf8');
const banner = readFileSync(new URL('../components/CookieBanner.astro', import.meta.url), 'utf8');
const cookiesGb = readFileSync(new URL('../components/legal/gb/CookiesBody.astro', import.meta.url), 'utf8');

describe('ga4IdProblem', () => {
  it('accepts a real id, ignores an unset one, refuses the placeholder and anything malformed', () => {
    expect(ga4IdProblem('G-L7JGXKQVNV')).toBeNull(); // Moreno Valley's real id (site-config.ts)
    expect(ga4IdProblem(undefined)).toBeNull();
    expect(ga4IdProblem(GA4_PLACEHOLDER)).toMatch(/placeholder/);
    expect(ga4IdProblem('UA-12345-1')).toMatch(/not a GA4/);
    expect(ga4IdProblem('G-short')).toMatch(/not a GA4/);
  });
  it('only UK towns need opt-in', () => {
    expect(ga4NeedsOptIn('gb')).toBe(true);
    expect(ga4NeedsOptIn('us')).toBe(false);
  });
});

describe('BaseLayout wiring', () => {
  it('throws at build on a placeholder or malformed id, and the opt-in script is separate from the opt-out one', () => {
    expect(layout).toContain('ga4IdProblem(siteConfig.ga4MeasurementId)');
    expect(layout).toContain('throw new Error(`${siteConfig.townId}: ga4MeasurementId refused');
    expect(layout).toContain('import.meta.env.PROD && !ga4OptIn');
    expect(layout).toContain('import.meta.env.PROD && ga4OptIn');
  });
  it('shows "Cookie settings" in the footer of an opt-in town and the cookies page, both opening the banner again', () => {
    expect(layout).toContain('data-cookie-settings>Cookie settings</button>');
    expect(cookiesGb).toContain('data-cookie-settings>Cookie settings</button>');
    expect(banner).toContain("closest('[data-cookie-settings]')");
    expect(banner).toContain('banner.hidden = false');
  });
  it('the opt-in banner gives Accept and Decline the same style', () => {
    expect(banner).toContain("optIn ? 'banner__equal' : 'banner__accept'");
    expect(banner).not.toMatch(/\.banner__equal\s*\{/);
  });
  it('a UK town without GA4 shows no banner (nothing needs consent)', () => {
    expect(layout).toContain("(siteConfig.country !== 'gb' || !!siteConfig.ga4MeasurementId) && <CookieBanner");
  });
});

/** Runs the real opt-in <script is:inline> from BaseLayout in a fake browser. */
function optInScript(): string {
  const start = layout.indexOf('import.meta.env.PROD && ga4OptIn && (');
  const open = layout.indexOf('<script is:inline data-ga4-id', start);
  const body = layout.slice(layout.indexOf('>', open) + 1, layout.indexOf('</script>', open));
  return body;
}

function browser(stored: string | null) {
  const appended: string[] = [];
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const win: Record<string, unknown> = {
    addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] ||= []).push(f),
    dataLayer: undefined,
  };
  const ctx = {
    window: win,
    document: {
      currentScript: { dataset: { ga4Id: 'G-ABCDEFGH12' } },
      createElement: () => ({}),
      head: { appendChild: (el: { src?: string }) => appended.push(el.src ?? '') },
      cookie: '',
    },
    location: { hostname: 'www.glasgowloop.co.uk' },
    localStorage: { getItem: () => stored },
    encodeURIComponent, Date,
  };
  vm.createContext(ctx);
  vm.runInContext(optInScript(), ctx);
  return { appended, win, fire: (choice: string) => (listeners['bv:consent'] || []).forEach((f) => f({ detail: { choice } })) };
}

describe('the opt-in GA4 script, run for real', () => {
  const rec = (choice: string) => JSON.stringify({ choice, ts: 1 });
  it('loads nothing without a stored choice, after Decline, or when storage is unreadable', () => {
    expect(browser(null).appended).toEqual([]);
    expect(browser(rec('declined')).appended).toEqual([]);
    expect(browser('not json').appended).toEqual([]);
  });
  it('loads gtag.js only when the stored choice is accepted', () => {
    expect(browser(rec('accepted')).appended).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-ABCDEFGH12']);
  });
  it('Accept in the banner loads it at once; Decline later switches it off and the next page view loads nothing', () => {
    const b = browser(null);
    b.fire('accepted');
    expect(b.appended).toHaveLength(1);
    b.fire('declined');
    expect(b.win['ga-disable-G-ABCDEFGH12']).toBe(true);
    expect(browser(rec('declined')).appended).toEqual([]); // the next page view, with the stored Decline
  });
});
