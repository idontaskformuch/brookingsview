/** Browser side of the /tonight cards (spec .claude/specs/tonight-cards.md). The page is static and may be hours old, so everything that
 *  depends on the clock is recomputed here, in the town's zone, every minute: "in 26 min" / "On now", the Starting soon row, the header's
 *  count and "Next up", the chip counts, the Surprise me button. Area filtering and "See all" are DOM toggles. The rules themselves live
 *  in lib/tonight-cards.ts (tested); this file only reads data-* attributes and writes text and `hidden`. No network, no dependencies. */
import { hasEnded } from './local-day';
import { sectionState } from './evening-page';
import { showTimeGb } from './whats-on-dates';
import {
  timeState, isStartingSoon, matchesArea, nextUp, untilLabel, surprisePick, surpriseCandidates, SOON_MAX_CARDS,
  type SurpriseCard, type Bucket,
} from './tonight-cards';

const $$ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => Array.from(root.querySelectorAll<T>(sel));

interface Card { el: HTMLElement; id: string; start: string; end: string | null; area: string | null; bucket: Bucket }

function readCard(el: HTMLElement): Card {
  return { el, id: el.dataset.id || '', start: el.dataset.start || '', end: el.dataset.end || null, area: el.dataset.area || null, bucket: (el.dataset.bucket || 'other') as Bucket };
}

export function initTonightCards(doc: Document): void {
  const root = doc.querySelector<HTMLElement>('[data-tc]');
  if (!root) return;
  const tz = root.dataset.tz || 'UTC';
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let area: string | null = null;

  const sections = () => $$(doc, '[data-evening-day]');
  const visibleSections = () => sections().filter((s) => !s.hidden);

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
      clone.classList.add('tc-card--lg');
      clone.removeAttribute('hidden');
      return clone;
    }));
    const head = box.querySelector<HTMLElement>('[data-tc-soon-h]');
    if (head) head.textContent = soon.length > 0 ? 'Starting soon' : 'Up next';
    box.hidden = shown.length === 0;
  }

  function renderHeader(now: Date): void {
    const live = liveCards(now).filter((c) => matchesArea(c.area, null));
    const count = doc.querySelector<HTMLElement>('[data-tc-count]');
    const label = doc.querySelector<HTMLElement>('[data-tc-count-label]');
    const word = (visibleSections()[0]?.querySelector('[data-evening-heading]')?.textContent ?? 'Tonight').toLowerCase();
    if (count) count.textContent = String(live.length);
    if (label) label.textContent = `${live.length === 1 ? 'thing' : 'things'} on ${word}`;
    const next = doc.querySelector<HTMLElement>('[data-tc-next]');
    if (next) {
      const n = nextUp(live, now);
      next.hidden = !n;
      if (n) {
        const title = n.el.querySelector('.tc-title')?.textContent ?? '';
        next.textContent = `Next up ${untilLabel(n.start, now)}`;
        const t = doc.createElement('span');
        t.className = 'tc-next-title';
        t.textContent = ` · ${title}`;
        next.append(t);
      }
    }
  }

  function renderChips(now: Date): void {
    const live = liveCards(now);
    const chips = $$<HTMLButtonElement>(doc, '[data-tc-chip]');
    chips.forEach((chip) => {
      const a = chip.dataset.tcChip || '';
      const n = a === '' ? live.length : live.filter((c) => c.area === a).length;
      const num = chip.querySelector('[data-tc-chip-n]');
      if (num) num.textContent = String(n);
      chip.hidden = a !== '' && n === 0 && area !== a;
      chip.setAttribute('aria-pressed', String((a === '' ? null : a) === area));
    });
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
