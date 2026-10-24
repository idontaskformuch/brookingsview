// Pure per-page QA checks (no browser needed) -- unit-tested in
// site/src/lib/qa-checks.test.ts. run.mjs builds a `snap` per page and feeds it here.
//
// snap = { url, path, status, redirects, title, titleCount, h1: string[], metaRobots,
//          mainText, shellText, metaDescription, imgAlts: string[], loneDashNodes: number,
//          brokenImgs: string[], consoleErrors: string[], failedRequests: string[],
//          blockedAttempts: string[] }

/** Elements carrying this attribute are hidden before the page text is read, so deliberate,
 *  disclosed cross-town references (about page: sister sites, Phase H) never trip web.leak. */
export const ALLOW_SIBLING_SELECTOR = '[data-qa-allow-sibling-sites]';

/** Key pages for Pass B (kept only if they are in the town's sitemap). */
export const KEY_PAGES = ['/', '/today/', '/events/', '/whats-on/', '/this-week/', '/city-hall/', '/weather/', '/traffic/', '/closures/', '/jobs/', '/about/'];
/** Pass C: browser clock at these town-local times, on these pages. */
export const CLOCK_TIMES = ['07:00', '19:00', '23:30'];
export const CLOCK_PAGES = ['/today/', '/events/', '/'];

/** The UTC instant at which `tz` shows `day` ('YYYY-MM-DD') at `hhmm`. */
export function zonedInstant(day, hhmm, tz) {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    t += want - shown;
  }
  return new Date(t);
}

/** Loose code characters in visible text: undefined/NaN/null, [object Object], Invalid Date, "{{", "}}", "${" and ")}".
 *  ")}" and "${" were added 2026-10-23 after a stray ")}" sat under the navigation on every page for two days
 *  (a leftover `</nav> )}` in BaseLayout.astro): the header is outside <main>, so the check also reads shellText. */
export const LITERAL_RE = /\b(undefined|NaN|null)\b|\[object Object\]|Invalid Date|\{\{|\}\}|\$\{|\)\}/g;

export function finding(check, town, snap, message, extra = {}) {
  return { check, town, url: snap.url, path: snap.path, message, ...extra };
}

/** Compile a town's blocklist ({town: terms[]}) into one RegExp per town. */
export function compileBlocklist(blocklist) {
  const out = {};
  for (const [town, terms] of Object.entries(blocklist)) {
    const parts = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    out[town] = parts.length ? new RegExp(`(?<![\\w])(?:${parts.join('|')})(?![\\w])`, 'gi') : null;
  }
  return out;
}

export function checkPage(snap, town, compiled) {
  const f = [];
  if (snap.cfMitigated) f.push(finding('web.status', town, snap, `Cloudflare ${snap.cfMitigated} (cf-mitigated) -- QA traffic is being challenged/blocked, see qa/README.md (WAF header)`));
  else if (snap.status !== 200) f.push(finding('web.status', town, snap, `HTTP ${snap.status}`));
  else if (snap.redirects > 2) f.push(finding('web.status', town, snap, `${snap.redirects} redirects`));
  if (snap.status !== 200) return f; // content checks are meaningless on an error page

  if (!snap.imagesBlocked) for (const src of snap.brokenImgs) f.push(finding('web.img', town, snap, `broken image ${src}`));
  for (const m of snap.consoleErrors) f.push(finding('web.console', town, snap, m.slice(0, 300)));
  for (const m of snap.failedRequests) f.push(finding('web.console', town, snap, `failed request ${m}`.slice(0, 300)));

  // mainText = <main>; shellText = everything else visible (header, nav, sign strip, footer)
  const lits = new Set([...(snap.mainText.match(LITERAL_RE) ?? []), ...((snap.shellText ?? '').match(LITERAL_RE) ?? [])]);
  if (snap.loneDashNodes > 0) lits.add('--');
  if (lits.size) f.push(finding('web.literal', town, snap, `visible: ${[...lits].join(', ')}`));

  if (snap.h1.length !== 1) f.push(finding('web.h1', town, snap, `${snap.h1.length} <h1> elements`));
  if (snap.titleCount !== 1) f.push(finding('web.h1', town, snap, `${snap.titleCount} <title> elements`));
  else if (!snap.title.trim()) f.push(finding('web.h1', town, snap, 'empty <title>'));

  const re = compiled?.[town];
  if (re) {
    const hay = [snap.title, snap.metaDescription, snap.mainText, ...snap.imgAlts].join('\n');
    const hits = new Set([...hay.matchAll(re)].map((m) => m[0]));
    if (hits.size) f.push(finding('web.leak', town, snap, `other-town terms: ${[...hits].slice(0, 6).join(', ')}`));
  }

  if (/noindex/i.test(snap.metaRobots ?? '') && snap.inSitemap) {
    f.push(finding('web.noindex-sitemap', town, snap, 'noindex page listed in sitemap'));
  }
  if (snap.blockedAttempts.length) {
    f.push(finding('qa.tracking', town, snap, `tried: ${[...new Set(snap.blockedAttempts)].slice(0, 3).join(', ')}`));
  }
  return f;
}

/** Checks on what the page showed (Pass B/C probe + axe). Messages carry the combo/time label only where it matters. */
export function checkDiag(snap, town) {
  const f = [];
  if (snap.status !== 200) return f;
  const lab = snap.label ? ` [${snap.label}]` : '';
  for (const h of snap.emptySections ?? []) f.push(finding('web.empty', town, snap, `section "${h}" has a heading and no content`));
  const cf = snap.clientfill;
  if (cf && cf.items > 0 && !cf.tonight && !cf.tomorrow && !cf.none) {
    f.push(finding('web.clientfill', town, snap, `${cf.items} events in the template but Tonight/Tomorrow never filled and no "nothing scheduled" note${lab}`));
  }
  for (const a of snap.staleAlerts ?? []) f.push(finding('web.stale-alert', town, snap, `alert shown after its end: ${a}${lab}`));
  for (const e of snap.staleRecently ?? []) f.push(finding('web.stale-recently', town, snap, `"Recently" shows an event from more than 90 days ago: ${e}${lab}`));
  for (const e of snap.pastEvents ?? []) f.push(finding('web.past-event', town, snap, `${e}${lab}`));
  for (const e of snap.allDayClock ?? []) f.push(finding('web.allday-clock', town, snap, `all-day event shows a clock: ${e}${lab}`));
  for (const v of snap.axe ?? []) {
    const hard = v.impact === 'serious' || v.impact === 'critical';
    f.push(finding(hard ? 'web.axe' : 'web.axe-minor', town, snap, `${v.id} (${v.impact}, ${v.count} nodes): ${v.help}; e.g. ${v.targets.join(' | ')}${lab}`));
  }
  return f;
}

/** Run-level checks (cross-page). */
/** web.duplicate-content (owner 2026-10-23, born_from the University digest finding): when a page is MOSTLY (> 60 %) made of text
 *  that is already on a page that links to it, flag BOTH. Measured with 8-word shingles so a truncated teaser still counts
 *  as the same text. Needs snap.outLinks (internal hrefs found in <main>). Pages under 300 characters are never flagged. */
/** The owner said "t.ex. > 70 %"; the real University digest case measured 66 % (the card showed a truncated excerpt and the
 *  detail page adds breadcrumb, byline and related links), so the threshold is 60 %. */
export const DUP_THRESHOLD = 0.6;
export const DUP_MIN_CHARS = 300;
const SHINGLE = 8;
const norm = (p) => { try { return new URL(p, 'https://x.invalid').pathname.replace(/\/?$/, '/'); } catch { return null; } };
function shingles(text) {
  const w = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + SHINGLE <= w.length; i++) out.add(w.slice(i, i + SHINGLE).join(' '));
  return out;
}
export function duplicateContentFindings(snaps, town) {
  const ok = snaps.filter((s) => s.status === 200 && s.mainText && (s.outLinks ?? []).length >= 0);
  const byPath = new Map(ok.map((s) => [norm(s.path), s]));
  const cache = new Map();
  const sh = (s) => cache.get(s) ?? cache.set(s, shingles(s.mainText)).get(s);
  const f = [];
  const seen = new Set();
  for (const a of ok) {
    for (const href of new Set((a.outLinks ?? []).map(norm))) {
      const b = byPath.get(href);
      if (!b || b === a || b.mainText.length < DUP_MIN_CHARS) continue;
      const sb = sh(b);
      if (sb.size === 0) continue;
      const sa = sh(a);
      let hit = 0;
      for (const g of sb) if (sa.has(g)) hit++;
      const ratio = hit / sb.size;
      const key = `${a.path}>${b.path}`;
      if (ratio > DUP_THRESHOLD && !seen.has(key)) {
        seen.add(key);
        const pct = Math.round(ratio * 100);
        f.push({ check: 'web.duplicate-content', town, url: a.url, path: a.path, message: `${pct}% of the text of ${b.path} is repeated on this page, which links to it` });
        f.push({ check: 'web.duplicate-content', town, url: b.url, path: b.path, message: `${pct}% of this page's text is already on ${a.path}, which links here` });
      }
    }
  }
  return f;
}

export function checkRun(snaps, town) {
  const f = [...duplicateContentFindings(snaps, town)];
  const byTitle = new Map();
  for (const s of snaps) {
    if (s.status !== 200 || !s.title) continue;
    (byTitle.get(s.title) ?? byTitle.set(s.title, []).get(s.title)).push(s);
  }
  for (const [title, list] of byTitle) {
    if (list.length > 1) {
      f.push({ check: 'web.title-dup', town, url: list[0].url, path: '(multiple)',
        message: `"${title.slice(0, 80)}" on ${list.length} URLs, e.g. ${list.slice(0, 3).map((s) => s.path).join(' ')}` });
    }
  }
  return f;
}

/** Drop findings covered by an unexpired waiver. */
export function applyWaivers(findings, waivers, today) {
  return findings.filter((x) => !waivers.some((w) =>
    w.check === x.check && (!w.town || w.town === x.town) &&
    (w.url_pattern === '*' || (x.path ?? '').includes(w.url_pattern)) &&
    (!w.expires || w.expires >= today)));
}
