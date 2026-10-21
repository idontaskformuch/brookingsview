import { describe, expect, it } from 'vitest';
import { checkStatusContrast } from './status-contrast';
import { STATUS_TOKENS, statusTokensCss } from './status-tokens.mjs';

describe('status colors', () => {
  it('every text/background and marker pair clears WCAG in every mode', () => {
    expect(checkStatusContrast()).toEqual([]);
  });
  it('fails (and names the pair) when a color drops below the minimum', () => {
    const bad = structuredClone(STATUS_TOKENS);
    bad.light.ok.text = '#7be0a4'; // mint text on mint background
    const failures = checkStatusContrast(bad);
    expect(failures.some((f) => f.pair === 'ok.text on ok.bg')).toBe(true);
  });
  it('covers both light and dark', () => {
    expect(Object.keys(STATUS_TOKENS).sort()).toEqual(['dark', 'light']);
  });
  it('fails when a dark-mode pair drops below the minimum', () => {
    const bad = structuredClone(STATUS_TOKENS);
    bad.dark.alert.text = '#7f1d1d'; // dark red text on dark red background
    const failures = checkStatusContrast(bad);
    expect(failures.some((f) => f.mode === 'dark' && f.pair === 'alert.text on alert.bg')).toBe(true);
  });
  it('emits the three statuses plus legacy aliases as CSS variables', () => {
    const css = statusTokensCss();
    for (const n of ['ok', 'warn', 'alert']) {
      expect(css).toContain(`--status-${n}:`);
      expect(css).toContain(`--status-${n}-bg:`);
      expect(css).toContain(`--status-${n}-text:`);
    }
    expect(css).toContain('--status-good: var(--status-ok);');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain(':root:not([data-theme="light"])');
  });
});
