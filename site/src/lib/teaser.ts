/** A list teaser (Q3 calibration, 2026-10-23): list pages show the START of a story, the detail page the whole of it, so the
 *  same paragraph is not printed twice (the first Q3 run found whole summaries repeated verbatim on /city-hall/ and /events/ and
 *  their detail pages, and /city-hall/ at 2 850 words). Cuts at a sentence end when one falls between 60 and `max` characters,
 *  otherwise at a word boundary with an ellipsis. Short text is returned untouched. */
export function teaser(text: string, max = 220): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const ends = [...head.matchAll(/[.!?](?=\s|$)/g)].map((m) => (m.index ?? 0) + 1).filter((i) => i >= 60);
  if (ends.length) return head.slice(0, ends[ends.length - 1]);
  const cut = head.slice(0, head.lastIndexOf(' ') > 40 ? head.lastIndexOf(' ') : max).replace(/[\s,;:–-]+$/, '');
  return `${cut}…`;
}
