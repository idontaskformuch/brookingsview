/** What a reader sees and can follow on a piece of HTML: the visible text (scripts, styles and tags removed, entities decoded, whitespace
 *  collapsed) and every link target in order. Used to prove that a page moved into a shared layout kept its content (Fas 3, K1). */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rarr: '→', ndash: '–', mdash: '—', hellip: '…' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? m;
});

/** @param {string} html @returns {{ text: string, hrefs: string[] }} */
export function visibleText(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const hrefs = [...body.matchAll(/<a\b[^>]*\shref="([^"]*)"/gi)].map((m) => decode(m[1]));
  const text = decode(body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return { text, hrefs };
}
