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

/** Meta description length limits (web.description). */
export const DESCRIPTION_MIN = 70;
export const DESCRIPTION_MAX = 160;

/** Key pages for Pass B (kept only if they are in the town's sitemap). */
export const KEY_PAGES = ['/', '/today/', '/events/', '/whats-on/', '/this-week/', '/city-hall/', '/weather/', '/traffic/', '/closures/', '/jobs/', '/about/', '/sports/', '/trash-recycling/', '/home-sales/'];
/** Pass C: browser clock at these town-local times, on these pages. */
export const CLOCK_TIMES = ['07:00', '19:00', '23:30'];
export const CLOCK_PAGES = ['/today/', '/events/', '/'];
/** Evening layer (/tonight, /this-weekend): noindex, so never in the sitemap and never crawled by Pass A; Pass E loads them by name. */
export const EVENING_PAGES = ['/tonight/', '/this-weekend/'];

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

/** A heading that opens with "0 <word>". Prose like "0.5 miles" or "10 things" does not match. */
export const ZERO_COUNT_RE = /^0\s+[a-z]+(?:\s+[a-z]+)?\b/i;

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

  // web.description (owner 2026-11-03, Bing "too short"): every indexable page needs a 70-160 character description.
  // The templates (site/src/lib/meta-description.ts) aim for 120-160; below 70 or above 160 is a hard miss, 70-119 is only a nudge.
  if (!/noindex/i.test(snap.metaRobots ?? '')) {
    const n = (snap.metaDescription ?? '').trim().length;
    if (n === 0) f.push(finding('web.description', town, snap, 'meta description missing'));
    else if (n < DESCRIPTION_MIN) f.push(finding('web.description', town, snap, `meta description is ${n} characters (minimum ${DESCRIPTION_MIN})`));
    else if (n > DESCRIPTION_MAX) f.push(finding('web.description', town, snap, `meta description is ${n} characters (maximum ${DESCRIPTION_MAX})`));
  }

  // web.zero-count (owner 2026-11-05): a heading that announces a count of nothing ("0 most recent, through October 2025",
  // "0 things") is never useful to a resident; the page must name the section or say plainly that there is nothing.
  const zero = (snap.headingTexts ?? []).filter((l) => ZERO_COUNT_RE.test(l));
  if (zero.length) f.push(finding('web.zero-count', town, snap, `announces a count of zero: "${zero[0].slice(0, 80)}"`));

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
  if (snap.hscroll && /mobile/.test(snap.label ?? '')) f.push(finding('web.hscroll', town, snap, `page scrolls sideways at phone width (${snap.hscroll.scrollWidth}px wide in a ${snap.hscroll.clientWidth}px viewport); widest element: ${snap.hscroll.offender || 'unknown'}${lab}`));
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

/** web.routes (born 2026-10-28, owner): /ads.txt answered 200 with the body "Not found" on a site without an AdSense publisher id
 *  (a soft 404 that crawlers read as a broken ads.txt), and /advertise, what people type, 404ed instead of going to /advertising/.
 *  probes = { adsTxt: { status, body }, advertise: { status, location } } (redirects NOT followed). A 200 /ads.txt is fine only when
 *  it holds a real record (pub- plus 16 digits, not all zeros); otherwise it must be a real 404. */
export function routeFindings(town, base, probes) {
  const f = [];
  const ads = probes.adsTxt;
  if (ads) {
    const real = /^\s*[a-z0-9.-]+\.[a-z]+,\s*pub-(?!0{16}\b)\d{16},\s*(DIRECT|RESELLER)/im.test(ads.body ?? '');
    if (ads.status === 200 && !real) f.push({ check: 'web.routes', town, url: `${base}/ads.txt`, path: '/ads.txt', message: 'ads.txt answers 200 without a valid record (soft 404); it must be a real 404 until there is a publisher id' });
    else if (ads.status !== 200 && ads.status !== 404) f.push({ check: 'web.routes', town, url: `${base}/ads.txt`, path: '/ads.txt', message: `ads.txt answers HTTP ${ads.status}, expected 404 (or 200 with a real record)` });
  }
  const adv = probes.advertise;
  if (adv) {
    const to = adv.location ? new URL(adv.location, base).pathname : '';
    if (adv.status !== 301 || to !== '/advertising/') f.push({ check: 'web.routes', town, url: `${base}/advertise`, path: '/advertise', message: `/advertise answers HTTP ${adv.status}${adv.location ? ` -> ${adv.location}` : ''}, expected a 301 to /advertising/` });
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
  const byDesc = new Map();
  for (const s of snaps) {
    const d = (s.metaDescription ?? '').trim();
    if (s.status !== 200 || !d || /noindex/i.test(s.metaRobots ?? '')) continue;
    (byDesc.get(d) ?? byDesc.set(d, []).get(d)).push(s);
  }
  for (const [d, list] of byDesc) {
    const paths = [...new Set(list.map((s) => s.path))];
    if (paths.length > 1) {
      f.push({ check: 'web.description', town, url: list[0].url, path: '(multiple)',
        message: `same meta description on ${paths.length} URLs, e.g. ${paths.slice(0, 3).join(' ')}: "${d.slice(0, 70)}"` });
    }
  }
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

/** Evening-layer checks (Pass E, snap.evening from the page probe). Born 2026-10-29/30 from the step-7 review of the live pages:
 *  (1) the browser re-count said "24 things on tonight" with 12 tonight + 12 tomorrow night; (2) Open late rows read "Pub, closes
 *  until 3am"; (3) Essy Sparrow, a singer at SWG3, had been grouped "Clubs & late" at 7 pm (fixed earlier, now guarded here).
 *  approved = paths the owner has said yes to index (qa/evening-index-approved.json); everything else MUST stay noindex. */
const CLUB_WORDS = /\b(club night|dj set|dj|rave|disco|late night)\b/i; // mirrors CLUB_RE in site/src/lib/evening-items.ts
/** Titles that are fine in capitals: a known abbreviation only ("OVO"), mirrors KEEP_UPPER in site/src/lib/evening-names.ts. */
const ALLCAPS_OK = /^(OVO|SEC|BBC|DJ|UK|USA|FC|AFC|UFC|WWE|NBA|NFL|NHL|MLS|CU|DU|TV|VIP|SWG3|IHOP|HQ)(\s|$)/;
const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function eveningFindings(snap, town, approved = []) {
  const f = [];
  const ev = snap.evening;
  if (snap.status !== 200 || !ev) return f;
  const lab = snap.label ? ` [${snap.label}]` : '';
  const add = (check, message) => f.push(finding(check, town, snap, /ended-row|summary-count/.test(check) ? message + lab : message));
  if (!/noindex/i.test(snap.metaRobots ?? '') && !approved.includes(snap.path)) add('evening.index-gate', 'indexable without the owner approving it (no noindex in the robots meta)');
  const seen = new Map();
  for (const d of ev.days) {
    let prev = null;
    for (const e of d.entries) {
      if (!e.visible) continue;
      if (e.title.length >= 4 && /[A-Z]{3}/.test(e.title) && !/[a-z]/.test(e.title) && !ALLCAPS_OK.test(e.title)) add('evening.allcaps-title', `"${e.title}" is shown entirely in capitals`);
      if (/\b(venue|arena|stadium|theat(re|er)|backstage|facility|building)\s+tours\s*$/i.test(e.title)) add('evening.tour-listing', `"${e.title}" is a building tour, not an event`);
      if (/\?{2,}/.test(e.title)) add('evening.garbled-title', `"${e.title}" has lost characters ("??")`);
      if (!e.href) add('evening.row-source', `"${e.title}" has no link to its source`);
      const k = `${e.start}|${normTitle(e.title)}`;
      if (seen.has(k)) add('evening.dup-row', `"${e.title}" (${e.start}) is listed twice`); else seen.set(k, 1);
      if (e.end !== null ? Date.parse(e.end) <= Date.parse(ev.nowIso) : Date.parse(e.start) + 3 * 3600_000 <= Date.parse(ev.nowIso)) add('evening.ended-row', `"${e.title}" started ${e.start} and is over but still shown`);
      if (e.group === 'Clubs & late' && e.localHour >= 5 && e.localHour < 22 && !CLUB_WORDS.test(e.title)) add('evening.group-misfit', `"${e.title}" starts at ${e.localHour}:00 but sits under Clubs & late`);
      if (e.list === 'rows') {
        if (prev && prev.group === e.group && prev.day === d.id && Date.parse(e.start) < Date.parse(prev.start)) add('evening.order', `"${e.title}" comes after a later start in ${e.group}`);
        prev = { group: e.group, day: d.id, start: e.start };
      }
    }
    const lateNames = new Set();
    for (const p of d.late) {
      if (/closes\s+(until|open)/i.test(p.meta)) add('evening.open-late-wording', `"${p.name}": "${p.meta}" (the time is already in the time column)`);
      if (lateNames.has(p.name)) add('evening.dup-row', `Open late lists "${p.name}" twice`); else lateNames.add(p.name);
    }
  }
  // one spelling per venue: the same venue folded (case, accents, leading The, punctuation) must not appear spelled two ways
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const spellings = new Map();
  for (const d of ev.days) for (const x of [...d.entries.map((e) => e.venue), ...d.late.map((p) => p.name)]) {
    if (!x) continue;
    const k = fold(x);
    (spellings.get(k) ?? spellings.set(k, new Set()).get(k)).add(x);
  }
  for (const set of spellings.values()) if (set.size > 1) add('evening.venue-spelling', `one venue spelled ${[...set].map((x) => `"${x}"`).join(' and ')}`);
  if (/what is free|and free,/i.test(ev.aboutText ?? '') && !ev.freeCount) add('evening.free-claim', 'the page says it shows what is free, but no Free label or group is shown');
  if (/this-weekend/.test(snap.path) && ev.weatherText && !/(Friday|Saturday|Sunday)/.test(ev.weatherText)) add('evening.weekend-forecast', `the weather line does not cover the weekend: "${ev.weatherText.slice(0, 80)}"`);
  const first = ev.days.find((d) => d.visible);
  if (ev.summaryCount !== null && first && ev.period === 'tonight') {
    const shown = first.entries.filter((e) => e.visible).length;
    if (ev.summaryCount !== shown) add('evening.summary-count', `summary says ${ev.summaryCount} things on tonight but the first section shows ${shown}`);
  }
  const read = /read (\d{4}-\d{2}-\d{2})/.exec(ev.aboutText ?? '');
  if (!ev.aboutText) add('evening.sources', 'the "How we gather this" text is missing');
  else if (read && Date.parse(ev.nowIso) - Date.parse(read[1]) > 3 * 86_400_000) add('evening.stale-read', `sources "read ${read[1]}" is more than 3 days old; the page was not rebuilt`);
  const checked = /Checked (\d{4}-\d{2}-\d{2})/.exec(ev.aboutText ?? '');
  if (checked && Date.parse(ev.nowIso) - Date.parse(checked[1]) > 30 * 86_400_000) add('evening.stale-read', `Getting home "Checked ${checked[1]}" is more than 30 days old (annual.md: re-check)`);
  return f;
}

/** Public-safety notices (/today line and /safety/, snap.safety = the text the browser built from /api/safety). Born 2026-10-29 from the
 *  public-safety plan (.claude/specs/public-safety.md, "QA-regel"): these pages are about fire and air, never about crime, and a page that
 *  cannot reach its data must say so instead of showing nothing. Mirrors CRIME_WORDS in site/src/lib/safety-filter.ts. */
const SAFETY_CRIME = /\b(arrest|arrested|charged|charges|court|trial|sentenced|convicted|victims?|missing|murder|homicide|assault|stabbing|shooting|suspects?|manhunt|wanted|bail|died|dead|death|killed|fatal|body)\b/i;
export function safetyFindings(snap, town) {
  const f = [];
  if (snap.status !== 200 || !snap.safety) return f;
  const hit = SAFETY_CRIME.exec(snap.safety.text);
  if (hit) f.push(finding('safety.crime-word', town, snap, `a public-safety notice contains "${hit[0]}"`));
  if (snap.safety.unavailable) f.push(finding('safety.unavailable', town, snap, 'the page says it cannot reach the fire or air data (is /api/safety or the cron job down?)'));
  return f;
}
