/**
 * Owner 2026-11-24: no empty-state text anywhere on the sites. An empty section is left out entirely and the page leads with what
 * it has (scripts/verify_no_empty_messages.mjs fails the build on one). The one line left is the answer to a visitor's own filter
 * in a client-side table (lib/data-table.ts): it is never in the built HTML and only shows after the visitor narrows the list.
 */
export const EMPTY_STATES = {
  searchFilter: 'Nothing matched. Try a broader filter.',
} as const;
