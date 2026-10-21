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
// MODES: only `light` exists today. Dark mode (a later phase) adds a `dark`
// entry with its own page/paper values and the SAME checks run on it; no
// component needs to change because they only ever read the CSS variables.

export const PAGE = {
  light: { paper: '#fbfaf7', surface: '#ffffff', ink: '#161614' },
};

export const STATUS_TOKENS = {
  light: {
    ok:    { marker: '#1a7f45', bg: '#dcfce7', text: '#14532d' },
    warn:  { marker: '#a86b00', bg: '#fdf1cf', text: '#5c3b00' },
    alert: { marker: '#c0261c', bg: '#fee2e2', text: '#7f1d1d' },
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
  return `:root {\n${block('light')}\n}\n`;
}
