/**
 * Broomfield AdSense plan F6 (2026-11-11): /facilities/broomfield-recycling-center/ showed "see NEEDS-HUMAN-REVIEW.md for the open
 * discrepancy" -- a working note from the data file reached the page. This finds such notes in a built page: the visible text
 * (scripts, styles and comments left out), the <title> and the meta description.
 */

export const PATTERNS = [
  { name: 'NEEDS-HUMAN-REVIEW', re: /NEEDS-HUMAN-REVIEW/i },
  { name: '.md file name', re: /\b[\w-]+\.md\b/ },
  // capitals only: "Pending" in running text is ordinary English, "PENDING"/"TODO"/"FIXME" are a developer's markers
  { name: 'TODO', re: /\bTODO\b/ },
  { name: 'FIXME', re: /\bFIXME\b/ },
  { name: 'PENDING', re: /\bPENDING\b/ },
];

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** The text a reader or a search result sees: the page's visible text, its <title> and its meta description. */
export function readableParts(html) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim());
  const description = decode(html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)?.[1] ?? '');
  const body = decode(
    (html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ');
  return { title, description, body };
}

/** Every internal note in a built page, as { where, name, text } with a little context around the hit. */
export function findInternalNotes(html) {
  const found = [];
  for (const [where, text] of Object.entries(readableParts(html))) {
    for (const p of PATTERNS) {
      const m = p.re.exec(text);
      if (m) found.push({ where, name: p.name, text: text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50).trim() });
    }
  }
  return found;
}
