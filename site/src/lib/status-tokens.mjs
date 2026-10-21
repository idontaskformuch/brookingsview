// Single source of truth for the shared status colors (ok / warn / alert).
// Plain .mjs on purpose: astro.config.mjs runs BEFORE Vite's module graph
// exists (same constraint as BRAND_TOKENS there), so it must be importable
// without TypeScript; lib/status-contrast.ts and the vitest suite import the
// very same table, so the CSS that ships and the contrast that is checked
// cannot drift apart.
//
// Shape per status: `marker` is the small dot / border color (non-text, needs
// 3:1 against the page), `bg` the tint behind a status block, `text` the text
// color placed on that tint (4.5:1). A status is *marked* by the dot/border;
// its words stay in ordinary text color -- never mint-on-mint again.
//
// MODES: `light` and `dark`. Each mode has its own page/paper values and the
// SAME checks run on both (lib/status-contrast.ts); no component needs to
// change because they only ever read the CSS variables. PAGE.dark must equal
// the dark --paper/--surface/--ink/--ink-soft/--ink-faint/-tint values in BaseLayout.astro (guarded by
// lib/theme-tokens.test.ts).

export const PAGE = {
  light: { paper: '#fbfaf7', surface: '#ffffff', ink: '#161614',
           inkSoft: '#55554f', inkFaint: '#6b6a63', navyTint: '#e7edf4', accentTint: '#fbede4' },
  dark:  { paper: '#121210', surface: '#1c1c19', ink: '#ece9e1',
           inkSoft: '#b8b5ab', inkFaint: '#9b988e', navyTint: '#1b2a3d', accentTint: '#3a2415' },
};

export const STATUS_TOKENS = {
  light: {
    ok:    { marker: '#1a7f45', bg: '#dcfce7', text: '#14532d' },
    warn:  { marker: '#a86b00', bg: '#fdf1cf', text: '#5c3b00' },
    alert: { marker: '#c0261c', bg: '#fee2e2', text: '#7f1d1d' },
  },
  dark: {
    ok:    { marker: '#4ade80', bg: '#10301d', text: '#bbf7d0' },
    warn:  { marker: '#fbbf24', bg: '#33260a', text: '#fde68a' },
    alert: { marker: '#f87171', bg: '#3b1616', text: '#fecaca' },
  },
};

export const MIN_TEXT = 4.5;
export const MIN_NON_TEXT = 3;

/** CSS for /status-tokens.css. Legacy --status-good/bad/caution(-tint/-ink)
 *  names stay as aliases so the pages that already use them keep working. */
export function statusTokensCss() {
  const block = (mode) => {
    const t = STATUS_TOKENS[mode];
    const lines = [];
    for (const [name, v] of Object.entries(t)) {
      lines.push(`  --status-${name}: ${v.marker};`);
      lines.push(`  --status-${name}-bg: ${v.bg};`);
      lines.push(`  --status-${name}-text: ${v.text};`);
    }
    lines.push('  --status-good: var(--status-ok);', '  --status-good-tint: var(--status-ok-bg);', '  --status-good-ink: var(--status-ok-text);');
    lines.push('  --status-bad: var(--status-alert);', '  --status-bad-tint: var(--status-alert-bg);', '  --status-bad-ink: var(--status-alert-text);');
    lines.push('  --status-caution: var(--status-warn);', '  --status-caution-tint: var(--status-warn-bg);', '  --status-caution-ink: var(--status-warn-text);');
    return lines.join('\n');
  };
  // Dark applies when the OS prefers it AND the visitor has not forced light,
  // or when the visitor forced dark with the header toggle (data-theme on <html>).
  const indent = (text) => text.replace(/^/gm, '  ');
  return `:root {\n${block('light')}\n}\n` +
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${indent(block('dark'))}\n  }\n}\n` +
    `:root[data-theme="dark"] {\n${block('dark')}\n}\n`;
}
