// Pure per-page QA checks (no browser needed) -- unit-tested in
// site/src/lib/qa-checks.test.ts. run.mjs builds a `snap` per page and feeds it here.
//
// snap = { url, path, status, redirects, title, titleCount, h1: string[], metaRobots,
//          mainText, metaDescription, imgAlts: string[], loneDashNodes: number,
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

export const LITERAL_RE = /\b(undefined|NaN|null)\b|\[object Object\]|Invalid Date|\{\{|\}\}/g;

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

  const lits = new Set((snap.mainText.match(LITERAL_RE) ?? []));
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
  for (const e of snap.pastEvents ?? []) f.push(finding('web.past-event', town, snap, `${e}${lab}`));
  for (const v of snap.axe ?? []) {
    const hard = v.impact === 'serious' || v.impact === 'critical';
    f.push(finding(hard ? 'web.axe' : 'web.axe-minor', town, snap, `${v.id} (${v.impact}, ${v.count} nodes): ${v.help}; e.g. ${v.targets.join(' | ')}${lab}`));
  }
  return f;
}

/** Run-level checks (cross-page). */
export function checkRun(snaps, town) {
  const f = [];
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
