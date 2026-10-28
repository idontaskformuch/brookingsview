// Build guard: a deploy may add at most MAX_NEW_INDEXABLE pages to the sitemap compared with what is live (owner 2026-10-27/28;
// .claude/specs/weekend-layer.md, "Skydd mot low value content" 6). A flood of new indexable pages is how a young site looks like
// low-value content; the guard makes that a decision instead of an accident. Override with ALLOW_NEW_INDEXABLE_PAGES=yes (a deliberate,
// visible choice). Pure functions here so the rule is unit-tested (src/lib/new-indexable.test.ts); astro.config.mjs does the hook.
export const MAX_NEW_INDEXABLE = 30;

const UA = { 'User-Agent': 'ViewMediaBot/1.0 (build guard)' };

/** Pathnames in a sitemap XML (<loc> entries). */
export function sitemapPaths(xml) {
  return [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => {
    try { return new URL(m[1].trim()).pathname; } catch { return m[1].trim(); }
  });
}

/** Sitemap-index XML -> the child sitemap URLs. */
export function childSitemaps(indexXml) {
  return [...String(indexXml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

/** What this build would newly advertise. */
export function newIndexable(builtPaths, livePaths) {
  const live = new Set(livePaths);
  return builtPaths.filter((p) => !live.has(p));
}

/** { ok, count, paths, message }. `allow` is the value of ALLOW_NEW_INDEXABLE_PAGES. */
export function checkNewIndexable(builtPaths, livePaths, allow, max = MAX_NEW_INDEXABLE) {
  const fresh = newIndexable(builtPaths, livePaths);
  const count = fresh.length;
  if (count <= max) return { ok: true, count, paths: fresh, message: `${count} new indexable page(s) vs live (limit ${max})` };
  if (String(allow).toLowerCase() === 'yes') {
    return { ok: true, count, paths: fresh, message: `${count} new indexable pages vs live: over the limit of ${max}, allowed by ALLOW_NEW_INDEXABLE_PAGES=yes` };
  }
  return {
    ok: false, count, paths: fresh,
    message: `${count} new indexable pages vs live is over the limit of ${max}. First: ${fresh.slice(0, 8).join(', ')}${count > 8 ? ', ...' : ''}. ` +
      'Add them deliberately: rerun with ALLOW_NEW_INDEXABLE_PAGES=yes (workflow input / env), or noindex the thin ones.',
  };
}

/** Live sitemap paths for a site URL, or null when they cannot be read (a young or offline site: the guard then only warns). */
export async function fetchLiveSitemapPaths(siteUrl, fetcher = fetch) {
  try {
    const res = await fetcher(new URL('/sitemap-index.xml', siteUrl), { headers: UA });
    if (!res.ok) return null;
    const out = [];
    for (const child of childSitemaps(await res.text())) {
      const r = await fetcher(child, { headers: UA });
      if (!r.ok) return null;
      out.push(...sitemapPaths(await r.text()));
    }
    return out;
  } catch {
    return null;
  }
}
