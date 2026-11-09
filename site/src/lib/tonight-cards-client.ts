/** Browser side of the /tonight cards (spec .claude/specs/tonight-cards.md). The page is static and may be hours old, so everything that
 *  depends on the clock is recomputed here, in the town's zone, every minute: "in 26 min" / "On now", the Starting soon row, the header's
 *  count and "Next up", the chip counts, the Surprise me button. Area filtering and "See all" are DOM toggles. The rules themselves live
 *  in lib/tonight-cards.ts (tested); this file only reads data-* attributes and writes text and `hidden`. No network, no dependencies. */
import { hasEnded } from './local-day';
import { sectionState } from './evening-page';
import { showTimeGb } from './whats-on-dates';
import {
  timeState, isStartingSoon, matchesArea, nextUp, untilLabel, surprisePick, surpriseCandidates, chipPlan, countByRegion, SOON_MAX_CARDS,
  scopeLine, dayView, heroFor, bigShowsLine, partitionBig, type SurpriseCard, type Bucket,
} from './tonight-cards';

const $$ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => Array.from(root.querySelectorAll<T>(sel));

interface Card { el: HTMLElement; id: string; start: string; end: string | null; area: string | null; bucket: Bucket; big: boolean }

function readCard(el: HTMLElement): Card {
  return { el, id: el.dataset.id || '', start: el.dataset.start || '', end: el.dataset.end || null, area: el.dataset.area || null, bucket: (el.dataset.bucket || 'other') as Bucket, big: el.dataset.big === '1' };
}

export function initTonightCards(doc: Document): void {
  const root = doc.querySelector<HTMLElement>('[data-tc]');
  if (!root) return;
  const tz = root.dataset.tz || 'UTC';
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let area: string | null = null;

  const sections = () => $$(doc, '[data-evening-day]');
  const visibleSections = () => sections().filter((s) => !s.hidden);

  /** Every card (events and Open late) in the first visible evening that is not over: what a chip tap shows. */
  const firstDayEverything = (): Card[] => {
    const sec = visibleSections()[0];
    return sec ? $$(sec, '[data-tc-rows] [data-card]').map(readCard) : [];
  };

  /** Cards in the first visible evening (what the header counts). */
  const firstDayCards = (): Card[] => {
    const sec = visibleSections()[0];
    return sec ? $$(sec, '[data-tc-rows] [data-card]:not([data-late])').map(readCard) : [];
  };
  const liveCards = (now: Date) => firstDayCards().filter((c) => !hasEnded({ start: c.start, end: c.end }, now, tz));

  function refresh(): void {
    const now = new Date();
    // 1. Evenings: hide one that is over, name the first visible one.
    sections().forEach((sec) => {
      const state = sectionState(Number(sec.dataset.eveningDay), now, tz);
      if (state.hidden) { sec.hidden = true; return; }
      const heading = sec.querySelector<HTMLElement>('[data-evening-heading]');
      if (heading) heading.textContent = state.kind === 'tonight' ? 'Tonight' : 'Tomorrow night';
    });
    // 2. Ended cards go (start + 3 h or the end time).
    $$(doc, '[data-tc-rows] [data-card], [data-pair]').forEach((el) => {
      const c = readCard(el);
      el.dataset.over = hasEnded({ start: c.start, end: c.end }, now, tz) ? '1' : '';
    });
    // 3. Live time on every event card.
    $$(doc, '[data-tc-rows] [data-card]:not([data-late]) [data-tc-time]').forEach((t) => {
      const card = t.closest<HTMLElement>('[data-card]')!;
      const s = timeState(card.dataset.start || '', card.dataset.end || null, now, tz);
      t.textContent = s.text;
      card.classList.toggle('is-now', s.kind === 'now');
      card.classList.toggle('is-soon', s.kind === 'soon');
    });
    applyFilter();
    renderDayViews();
    renderSoon(now);
    renderHeader(now);
    renderChips(now);
    renderSurprise(now);
  }

  /** Hide filtered/ended cards, hide empty categories, keep category counts and "See all" honest. */
  function applyFilter(): void {
    $$(doc, '[data-area], [data-card]').forEach((el) => {
      const out = el.dataset.over === '1' || !matchesArea(el.dataset.area || null, area);
      if (el.hasAttribute('data-card') || el.hasAttribute('data-pair')) el.hidden = out;
    });
    $$(doc, '[data-tc-cat]').forEach((cat) => {
      const shown = $$(cat, '[data-card]').filter((c) => !c.hidden);
      cat.hidden = shown.length === 0;
      const n = cat.querySelector('[data-tc-cat-count]');
      if (n) n.textContent = String(shown.length);
      const btn = cat.querySelector<HTMLButtonElement>('[data-tc-toggle]');
      if (btn) btn.hidden = shown.length < 3;
      renderTimeHeads(cat);
    });
    $$(doc, '[data-tc-pairs]').forEach((box) => { box.hidden = $$(box, '[data-pair]').every((p) => p.hidden); });
  }

  /** In an unfolded vertical list the start time is a heading once, not repeated on every card. */
  function renderTimeHeads(cat: HTMLElement): void {
    $$(cat, '.tc-timehead').forEach((h) => h.remove());
    if (!cat.classList.contains('is-open') || cat.dataset.bucket === 'late') return;
    let last = '';
    $$(cat, '[data-card]').filter((c) => !c.hidden).forEach((c) => {
      const label = showTimeGb(c.dataset.start || '', tz);
      if (!label || label === last) return;
      last = label;
      const li = doc.createElement('li');
      li.className = 'tc-timehead';
      li.setAttribute('aria-hidden', 'true');
      li.textContent = label;
      c.before(li);
    });
  }

  function renderSoon(now: Date): void {
    const row = doc.querySelector<HTMLElement>('[data-tc-soon]');
    const box = doc.querySelector<HTMLElement>('[data-tc-soon-box]');
    if (!row || !box) return;
    const pool = $$(doc, '[data-tc-rows] [data-card]:not([data-late])').filter((el) => el.closest('[data-evening-day]') === visibleSections()[0] && !el.hidden);
    const cards = pool.map(readCard).sort((a, b) => a.start.localeCompare(b.start));
    const soon = cards.filter((c) => isStartingSoon(c.start, c.end, now, tz));
    const shown = (soon.length > 0 ? soon : cards).slice(0, SOON_MAX_CARDS);
    row.replaceChildren(...shown.map((c) => {
      const clone = c.el.cloneNode(true) as HTMLElement;
      clone.removeAttribute('hidden');
      clone.removeAttribute('id'); // the original row keeps the anchor
      return clone;
    }));
    const head = box.querySelector<HTMLElement>('[data-tc-soon-h]');
    if (head) head.textContent = soon.length > 0 ? 'Starting soon' : 'Up next';
    box.hidden = shown.length === 0;
  }

  /** What is still to come in an evening: events and Open late places that have not ended, whatever the area filter says. */
  const toCome = (sec: HTMLElement) => ({
    events: $$(sec, '[data-tc-rows] [data-card]:not([data-late])').filter((c) => c.dataset.over !== '1').length,
    late: $$(sec, '[data-tc-rows] [data-card][data-late]').filter((c) => c.dataset.over !== '1').length,
  });

  const toComeBig = (sec: HTMLElement) => $$(sec, '[data-tc-rows] [data-card][data-big="1"]').filter((c) => c.dataset.over !== '1').length;

  /** An evening with nothing left shows no heading and no empty rows; with only Open late places left it shows just that row. The section is not
   *  `hidden` (that is the clock's job: it decides which evening is "first"), so the header can still speak for it. */
  function renderDayViews(): void {
    sections().forEach((sec) => { sec.dataset.tcView = dayView(toCome(sec)); });
  }

  function renderHeader(now: Date): void {
    const liveAll = liveCards(now).filter((c) => matchesArea(c.area, null));
    // big shows (Ticketmaster where bigShows is on) are never counted in the hero, the scope line or "Next up"; the "+ N big shows nearby" line counts them
    const { local: live, big: liveBig } = partitionBig(liveAll, (c) => c.big);
    const count = doc.querySelector<HTMLElement>('[data-tc-count]');
    const label = doc.querySelector<HTMLElement>('[data-tc-count-label]');
    const word = (visibleSections()[0]?.querySelector('[data-evening-heading]')?.textContent ?? 'Tonight').toLowerCase();
    const first = visibleSections()[0];
    const second = visibleSections()[1];
    const hero = heroFor({
      events: live.length, late: first ? toCome(first).late : 0, tomorrow: second ? toCome(second).events - toComeBig(second) : 0, word,
    });
    const countBox = doc.querySelector<HTMLElement>('[data-tc-count-box]');
    const emptyBox = doc.querySelector<HTMLElement>('[data-tc-empty]');
    if (countBox) countBox.hidden = hero.kind !== 'count';
    if (count) count.textContent = String(hero.count ?? 0);
    if (label) label.textContent = hero.label ?? '';
    if (emptyBox) {
      emptyBox.hidden = hero.kind !== 'empty';
      const text = emptyBox.querySelector<HTMLElement>('[data-tc-empty-text]');
      const link = emptyBox.querySelector<HTMLAnchorElement>('[data-tc-tomorrow]');
      if (text) text.textContent = hero.text ?? '';
      const sep = emptyBox.querySelector<HTMLElement>('[data-tc-empty-sep]');
      if (sep) sep.hidden = !hero.tomorrow;
      if (link) { link.hidden = !hero.tomorrow; link.textContent = hero.tomorrow ?? ''; link.href = `#${second?.querySelector('h2')?.id ?? 'tn-tomorrow-h'}`; }
    }
    const bigEl = doc.querySelector<HTMLElement>('[data-tc-big]');
    if (bigEl) {
      const text = bigShowsLine(liveBig.length);
      bigEl.hidden = !text;
      bigEl.textContent = text ?? '';
    }
    const scope = doc.querySelector<HTMLElement>('[data-tc-scope]');
    if (scope) {
      const counts = { home: 0, near: 0, unknown: 0 };
      for (const c of live) { const sc = c.el.dataset.scope; counts[sc === 'home' || sc === 'near' ? sc : 'unknown']++; }
      const text = scopeLine(counts, scope.dataset.home ?? '');
      scope.hidden = !text;
      scope.textContent = text ?? '';
    }
    const next = doc.querySelector<HTMLElement>('[data-tc-next]');
    if (next) {
      const n = nextUp(live, now);
      next.hidden = !n;
      if (n) {
        const title = n.el.querySelector('.tc-title, .pl__title')?.textContent ?? '';
        next.textContent = `Next up ${untilLabel(n.start, now)}`;
        const t = doc.createElement('span');
        t.className = 'tc-next-title';
        t.textContent = ` · ${title}`;
        next.append(t);
      }
    }
  }

  /** Chips carry no numbers. A chip shows with >= 3 things tonight (events + Open late), the row with >= 2 such chips; the selected chip stays. */
  function renderChips(now: Date): void {
    const nav = doc.querySelector<HTMLElement>('[data-tc-chips]');
    if (!nav) return;
    const chips = $$<HTMLButtonElement>(nav, '[data-tc-chip]').filter((c) => c.dataset.tcChip);
    const order = chips.map((c) => c.dataset.tcChip!);
    const live = firstDayEverything().filter((c) => !hasEnded({ start: c.start, end: c.end }, now, tz));
    let plan = chipPlan(countByRegion(live.map((c) => c.area)), order, area);
    if (!plan.showRow && area !== null) {
      area = null; // never leave a filter on with no chip to clear it
      plan = chipPlan(countByRegion(live.map((c) => c.area)), order, null);
      applyFilter();
    }
    nav.hidden = !plan.showRow;
    chips.forEach((chip) => { chip.hidden = !plan.visible.includes(chip.dataset.tcChip!); });
    $$<HTMLButtonElement>(nav, '[data-tc-chip]').forEach((chip) => chip.setAttribute('aria-pressed', String((chip.dataset.tcChip || null) === area)));
  }

  function renderSurprise(now: Date): void {
    const btn = doc.querySelector<HTMLButtonElement>('[data-tc-surprise]');
    if (!btn) return;
    btn.hidden = surpriseCandidates(surpriseCards(), now, tz, area).length === 0;
  }

  const surpriseCards = (): SurpriseCard[] => firstDayCards().map(({ el: _el, ...c }) => c);

  // Chips
  doc.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const chip = target.closest<HTMLElement>('[data-tc-chip]');
    if (chip) {
      area = chip.dataset.tcChip ? chip.dataset.tcChip : null;
      if (!reduced) $$(doc, '[data-card]:not([hidden])').forEach((c) => { c.classList.remove('tc-enter'); void c.offsetWidth; c.classList.add('tc-enter'); });
      refresh();
      return;
    }
    const toggle = target.closest<HTMLElement>('[data-tc-toggle]');
    if (toggle) {
      const cat = toggle.closest<HTMLElement>('[data-tc-cat]')!;
      const open = cat.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Show less' : 'See all';
      renderTimeHeads(cat);
      return;
    }
    if (target.closest('[data-tc-surprise]')) {
      const now = new Date();
      const pick = surprisePick(surpriseCards(), now, tz, area);
      if (!pick) return;
      const el = $$(doc, '[data-tc-rows] [data-card]').find((c) => c.dataset.id === pick.id);
      if (!el) return;
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center', inline: 'center' });
      if (!reduced) { el.classList.remove('tc-hit'); void el.offsetWidth; el.classList.add('tc-hit'); }
      el.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
    }
  });

  refresh();
  setInterval(refresh, 60_000);
}
