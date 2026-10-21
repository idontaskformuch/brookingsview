import { afterEach, describe, expect, it, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

/** Renders the real HeatAdvisoryWidget.astro against fixtures. SITE_CITY is
 *  read at site-config module load, so each case resets modules and re-imports
 *  under the town being simulated. */
async function render(city: string, props: { tempF: number | null; activeAlertTitles: string[] }) {
  vi.resetModules();
  vi.stubEnv('SITE_CITY', city);
  const { default: Widget } = await import('./HeatAdvisoryWidget.astro');
  const container = await AstroContainer.create();
  return container.renderToString(Widget, { props });
}

afterEach(() => vi.unstubAllEnvs());

describe('HeatAdvisoryWidget rendering', () => {
  it('Moreno Valley, caution fixture (dust alert): renders the caution box', async () => {
    const html = await render('moreno_valley_ca', { tempF: 82, activeAlertTitles: ['Blowing Dust Advisory'] });
    expect(html).toContain('heat-advisory--caution');
    expect(html).toContain('Caution for outdoor &amp; loading-dock work');
    expect(html).toContain('Blowing Dust Advisory');
  });

  it('Moreno Valley, caution fixture (92°F, no alert)', async () => {
    const html = await render('moreno_valley_ca', { tempF: 92, activeAlertTitles: [] });
    expect(html).toContain('heat-advisory--caution');
    expect(html).toContain('92°F – use caution outdoors');
  });

  it('Moreno Valley, high-risk fixture (Excessive Heat Warning)', async () => {
    const html = await render('moreno_valley_ca', { tempF: 108, activeAlertTitles: ['Excessive Heat Warning'] });
    expect(html).toContain('heat-advisory--high-risk');
    expect(html).toContain('High risk for outdoor &amp; loading-dock work');
    expect(html).toContain('Excessive Heat Warning');
  });

  it('Moreno Valley, safe conditions: nothing is rendered', async () => {
    const html = await render('moreno_valley_ca', { tempF: 75, activeAlertTitles: [] });
    expect(html).not.toContain('heat-advisory');
    expect(html).not.toContain('loading-dock');
  });

  it.each(['brookings_sd', 'broomfield_co'])('%s: never renders, even for a high-risk fixture', async (city) => {
    const html = await render(city, { tempF: 108, activeAlertTitles: ['Excessive Heat Warning'] });
    expect(html).not.toContain('loading-dock');
    expect(html).not.toContain('class="heat-advisory');
  });
});
