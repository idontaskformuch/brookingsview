import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ga4GuardProblem, ga4NeedsOptIn } from './ga4';

// GA4 for Glasgow (owner 2026-11-24): opt-in for every visitor, a way to change the choice, a placeholder the build refuses.
const layout = readFileSync(new URL('../layouts/BaseLayout.astro', import.meta.url), 'utf8');
const banner = readFileSync(new URL('../components/CookieBanner.astro', import.meta.url), 'utf8');
const cookiesGb = readFileSync(new URL('../components/legal/gb/CookiesBody.astro', import.meta.url), 'utf8');

describe('ga4GuardProblem', () => {
  it('stops the build only for a UK town with an id that is not in opt-in mode', () => {
    expect(ga4GuardProblem('gb', 'G-ABCDEFGH12', false)).toMatch(/opt-in/);
    expect(ga4GuardProblem('gb', 'G-ABCDEFGH12', true)).toBeNull();
    expect(ga4GuardProblem('gb', undefined, false)).toBeNull(); // no id: nothing rendered, no build error
    expect(ga4GuardProblem('us', 'G-L7JGXKQVNV', false)).toBeNull(); // Moreno Valley's real id, opt-out as before
  });
  it('the opt-in mode comes from the country profile: gb opt-in, us opt-out', () => {
    expect(ga4NeedsOptIn('gb')).toBe(true);
    expect(ga4NeedsOptIn('us')).toBe(false);
  });
});

describe('gb legal texts match what the site does (owner 2026-11-24)', () => {
  const privacyGb = readFileSync(new URL('../components/legal/gb/PrivacyBody.astro', import.meta.url), 'utf8');
  it('cookies page: Cloudflare is cookie-free, GA4 only after Accept, change via Cookie settings, the _ga cookies named', () => {
    expect(cookiesGb).toContain('It is cookie-free');
    expect(cookiesGb).toContain('switched off until you press <strong>Accept</strong>');
    expect(cookiesGb).toContain('data-cookie-settings>Cookie settings</button>');
    expect(cookiesGb).toContain('<code>_ga</code>');
  });
  it('privacy page: Google as recipient, consent only, 14-month retention', () => {
    expect(privacyGb).toContain('The recipient is Google');
    expect(privacyGb).toContain('Our lawful basis is your consent');
    expect(privacyGb).toContain('keep this data for 14 months');
  });
});

describe('BaseLayout wiring', () => {
  it('throws only through ga4GuardProblem, and the opt-in script is separate from the opt-out one', () => {
    expect(layout).toContain('ga4GuardProblem(siteConfig.country, siteConfig.ga4MeasurementId, ga4OptIn)');
    expect(layout).not.toContain('PLACEHOLDER');
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
  it('the opt-in banner is one short line with "More" to /cookies/; the longer sentences live on the cookies page (owner 2026-11-25)', () => {
    expect(banner).toContain('<p>We use cookies to see which pages people read. <a href="/cookies/">More</a></p>');
    const optInBranch = banner.slice(banner.indexOf('{optIn ? ('), banner.indexOf(') : (', banner.indexOf('{optIn ? (')));
    expect(optInBranch).not.toContain('Nothing is set');
    expect(optInBranch).not.toContain('Cookie settings');
    expect(cookiesGb).toContain('data-cookie-settings>Cookie settings</button>');
    // one line where it fits, the buttons straight under otherwise: a wrapping flex row, no fixed height
    expect(banner).toMatch(/\.banner--compact \.banner__inner \{[^}]*padding: 0\.5rem/);
    expect(banner).toContain('data-consent="declined">Decline</button>');
  });
  it('without an id there is no GA4 script, no footer "Cookie settings" and (UK) no banner', () => {
    expect(layout).toContain('{siteConfig.ga4MeasurementId && import.meta.env.PROD && !ga4OptIn && (');
    expect(layout).toContain('{siteConfig.ga4MeasurementId && import.meta.env.PROD && ga4OptIn && (');
    expect(layout).toContain('{ga4OptIn && siteConfig.ga4MeasurementId && <button');
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
