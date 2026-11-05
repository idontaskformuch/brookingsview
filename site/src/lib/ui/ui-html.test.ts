import { describe, expect, it } from 'vitest';
import { attrsHtml, curvePath, dayRowsHtml, esc, heroHtml, hourStripHtml, insightHtml, rangeBarHtml, sectionHeaderHtml } from './ui-html';
import { buildWeatherView } from '../weather-model';
import { weatherRegionHtml } from '../weather-html';

describe('escaping and attributes', () => {
  it('escapes markup characters', () => {
    expect(esc('<b>"a" & b</b>')).toBe('&lt;b&gt;&quot;a&quot; &amp; b&lt;/b&gt;');
    expect(esc(null)).toBe('');
  });
  it('attributes: true is bare, false/null/undefined are left out, strings are escaped', () => {
    expect(attrsHtml({ hidden: true, 'data-x': 'a"b', no: false, nil: null, undef: undefined })).toBe(' hidden data-x="a&quot;b"');
  });
});

describe('heroHtml / insightHtml / sectionHeaderHtml', () => {
  it('hero: value, unit, label, sub, meta and icon only when given; hooks spread on the elements', () => {
    const h = heroHtml({ value: 37, unit: 'F', label: 'Forecast for 7 AM', sub: 'Mostly Sunny', meta: 'High 58°', icon: 'sun', rootAttrs: { 'data-a': '1', hidden: true }, valueAttrs: { 'data-v': '' } });
    expect(h).toContain('class="ui-hero ui-hero--ink" data-a="1" hidden');
    expect(h).toContain('<span data-v="">37</span><span class="ui-hero__unit">F</span>');
    expect(h).toContain('ui-hero__label">Forecast for 7 AM');
    expect(h).toContain('ui-hero__sub">Mostly Sunny');
    expect(h).toContain('ui-hero__meta">High 58°');
    expect(h).toContain('ui-hero__icon');
    const bare = heroHtml({ value: 5 });
    expect(bare).not.toMatch(/ui-hero__(label|sub|meta|icon|unit)/);
  });
  it('hero text is escaped', () => {
    expect(heroHtml({ value: '<i>', sub: '<script>' })).not.toContain('<script>');
  });
  it('insight: icon optional, text escaped, slot html passed through', () => {
    expect(insightHtml({ text: 'Dry <until> 3pm', icon: 'sun' })).toContain('Dry &lt;until&gt; 3pm');
    expect(insightHtml({ html: '<b>x</b>' })).toContain('<span><b>x</b></span>');
    expect(insightHtml({ text: 'x', class: 'a', attrs: { hidden: true } })).toBe('<p class="ui-insight a" hidden><span>x</span></p>');
  });
  it('section header: kicker and see-all only when given', () => {
    expect(sectionHeaderHtml({ title: 'Week ahead' })).toBe('<header class="ui-sh"><div><h2 class="ui-sh__title">Week ahead</h2></div></header>');
    expect(sectionHeaderHtml({ title: 'T', kicker: 'K', seeAllHref: '/x/', level: 3 })).toContain('<h3 class="ui-sh__title">T</h3>');
  });
});

describe('rangeBarHtml', () => {
  it('draws nothing without numbers (no data, no element)', () => {
    expect(rangeBarHtml({ scaleMin: 0, scaleMax: 100, low: NaN, high: 5, unit: 'F' })).toBe('');
    expect(rangeBarHtml({ scaleMin: 0, scaleMax: 100, low: 50, high: 40, unit: 'F' })).toBe('');
  });
  it('carries the numbers as its text alternative and follows the unit’s colour stops', () => {
    const f = rangeBarHtml({ scaleMin: 0, scaleMax: 100, low: 41, high: 68, unit: 'F', label: 'Today' });
    expect(f).toContain('aria-label="Today: 41° to 68°"');
    expect(f).toContain('--temp-3');
    // 10 °C is 50 °F: stop 3 in either unit
    expect(rangeBarHtml({ scaleMin: 0, scaleMax: 30, low: 10, high: 10, unit: 'C' })).toContain('var(--temp-3)');
  });
});

describe('hourStripHtml', () => {
  const hrs = [
    { time: '1pm', temp: 40, icon: 'sun' as const, short: 'Sunny', pop: 0, current: true },
    { time: '2pm', temp: 44, icon: 'cloud' as const, short: 'Cloudy', pop: 70 },
    { time: '3pm', temp: 42, icon: null, short: '', pop: 5 },
  ];
  it('no hours, nothing', () => expect(hourStripHtml([], 'F')).toBe(''));
  it('one column per hour, the current one marked, a curve through all of them', () => {
    const h = hourStripHtml(hrs, 'F');
    expect((h.match(/<li class="ui-hr/g) ?? []).length).toBe(3);
    expect((h.match(/aria-current="time"/g) ?? []).length).toBe(1);
    expect((h.match(/<circle cx="[\d.]+" cy="[\d.]+" r="3"/g) ?? []).length).toBe(3);
    expect(h).toContain('width="168"');
    expect(h).toContain('aria-label="Next 24 hours (scrollable)"');
  });
  it('rain bars and percentages only when the forecast gives chance of precipitation; wet hours are marked, tiny chances get no label', () => {
    const h = hourStripHtml(hrs, 'F');
    expect(h).toContain('is-wet');
    expect(h).toContain('>70%<');
    expect(h).not.toContain('>5%<');
    const none = hourStripHtml(hrs.map((x) => ({ ...x, pop: null })), 'F');
    expect(none).not.toContain('ui-hr__rain');
  });
  it('a flat temperature gives a flat curve, a rising one slopes upwards (smaller y = higher)', () => {
    expect(curvePath([{ x: 28, y: 22 }, { x: 84, y: 22 }])).toBe('M28 22 L84 22');
    const flat = hourStripHtml([{ time: 'a', temp: 5 }, { time: 'b', temp: 5 }], 'C');
    expect(flat).toContain('cy="22"');
    expect(curvePath([])).toBe('');
  });
});

describe('dayRowsHtml', () => {
  const scale = { min: 20, max: 80 };
  const day = (over = {}) => ({ label: 'Tue', fullLabel: 'Tuesday', high: 60, low: 40, ...over });
  it('no days, nothing', () => expect(dayRowsHtml([], scale, 'F')).toBe(''));
  it('a day with details is a <details>; without details a plain row', () => {
    const h = dayRowsHtml([day({ details: [{ label: 'Wind', value: '5 mph N', icon: 'wind' }] }), day({ label: 'Wed' })], scale, 'F');
    expect((h.match(/<details>/g) ?? []).length).toBe(1);
    expect(h).toContain('ui-wd__flat');
    expect(h).toContain('<dt><svg');
    expect(h).toContain('5 mph N');
  });
  it('only a low (evening) or only a high prints a word, not a bar', () => {
    expect(dayRowsHtml([day({ high: null })], scale, 'F')).toContain('Low 40°');
    expect(dayRowsHtml([day({ low: null })], scale, 'F')).toContain('High 60°');
    expect(dayRowsHtml([day({ high: null })], scale, 'F')).not.toContain('ui-range');
  });
  it('chance of precipitation only when there is one; today is marked', () => {
    expect(dayRowsHtml([day({ pop: 60, today: true })], scale, 'F')).toContain('60%');
    expect(dayRowsHtml([day({ pop: 60, today: true })], scale, 'F')).toContain('is-today');
    expect(dayRowsHtml([day()], scale, 'F')).not.toContain('ui-wd__pop"><svg');
  });
});

describe('weatherRegionHtml', () => {
  const env = { now: new Date('2026-11-05T21:30:00Z'), tz: 'America/Denver', unit: 'F' as const, lat: 39.9, lon: -105.1, hourLabel: () => '2pm', clock: () => '7:00am' };
  it('is empty for a forecast with nothing in it', () => {
    expect(weatherRegionHtml(buildWeatherView({ periods: [], hourly: [] }, env))).toBe('');
  });
  it('hero first, then insights, the 24-hour strip and the week, in that order', () => {
    const periods = ['5', '6', '7'].flatMap((d) => [
      { start: `2026-11-0${d}T06:00:00-07:00`, temp: 50, short: 'Sunny', wind: '5 mph', is_daytime: true },
      { start: `2026-11-0${d}T18:00:00-07:00`, temp: 30, short: 'Clear', wind: '5 mph', is_daytime: false },
    ]);
    const hourly = Array.from({ length: 24 }, (_, i) => ({ start: new Date(Date.parse('2026-11-05T21:00:00Z') + i * 3_600_000).toISOString(), temp: 45, short: 'Sunny', wind: null, is_daytime: true }));
    const html = weatherRegionHtml(buildWeatherView({ periods, hourly }, env));
    const at = (s: string) => html.indexOf(s);
    expect(html.startsWith('<div class="ui-hero ')).toBe(true);
    expect(at('data-wx-insight="rain"')).toBeGreaterThan(at('ui-hero '));
    expect(at('Next 24 hours')).toBeGreaterThan(at('data-wx-insight="rain"'));
    expect(at('Week ahead')).toBeGreaterThan(at('Next 24 hours'));
    expect(at('ui-weekdays')).toBeGreaterThan(at('Week ahead'));
  });
  it('periods only (no hourly): the week and a fallback hero, no strip, no rain line', () => {
    const periods = [{ start: '2026-11-05T06:00:00-07:00', temp: 50, short: 'Sunny', wind: null, is_daytime: true }];
    const html = weatherRegionHtml(buildWeatherView({ periods, hourly: [] }, env));
    expect(html).toContain('Today’s high');
    expect(html).not.toContain('Next 24 hours');
    expect(html).not.toContain('data-wx-insight="rain"');
  });
});
