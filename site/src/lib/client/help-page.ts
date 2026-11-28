/** /help/ in the browser (spec Phase 3). Everything here only reorders or marks what the HTML already holds; without JavaScript all
 *  cards are shown, by name. Nothing is stored (no storage, no cookie).
 *   - today: the town-local weekday (<html data-timezone>) marks the day in each card's week strip and its hours line, and writes
 *     "N open today" into [data-help-today] (hidden when none: no empty-state text).
 *   - collapse: a list longer than COLLAPSE_AT shows the first ones and a "Show all N" button.
 *   - by area: [data-help-group] regroups each list under postal-district headings ("G40 · Bridgeton" when the row has an area name);
 *     press again = back to the current order.
 *   - postcode ([data-help-postcode] form, towns with help.postcodeSearch): ONE bulk lookup at postcodes.io (open data) of the
 *     visitor's postcode and the cards' postcodes, then nearest first with the distance on each card. When the lookup fails: the
 *     visitor's outcode first, then the same postcode area (help-view outcodeOrder). */
import { distanceKm, outcodeOrder, sortByDistance } from '../help-geo';

export const COLLAPSE_AT = 6;
const API = 'https://api.postcodes.io/postcodes';

export function townWeekday(now: Date, tz: string): number {
  const w = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(now);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w);
}

const days = (s: string | undefined) => (s ? s.split(',').filter(Boolean).map(Number) : []);

export function markToday(root: ParentNode, weekday: number): number {
  let open = 0;
  root.querySelectorAll<HTMLElement>('[data-help-card]').forEach((card) => {
    card.querySelectorAll('.is-today').forEach((el) => el.classList.remove('is-today'));
    if (!days(card.dataset.openDays).includes(weekday)) return;
    open += 1;
    card.querySelector(`.help-day[data-weekday="${weekday}"]`)?.classList.add('is-today');
    card.querySelectorAll<HTMLElement>('[data-weekdays]').forEach((li) => { if (days(li.dataset.weekdays).includes(weekday)) li.classList.add('is-today'); });
  });
  const out = root.querySelector<HTMLElement>('[data-help-today]');
  if (out) { out.textContent = open ? `${open} open today` : ''; out.hidden = open === 0; }
  return open;
}

function cardsOf(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>(':scope > [data-help-card]')];
}

function collapse(list: HTMLElement): void {
  const cards = cardsOf(list);
  const btn = list.parentElement?.querySelector<HTMLButtonElement>('[data-help-more]');
  const all = list.dataset.expanded === '1' || cards.length <= COLLAPSE_AT;
  cards.forEach((c, i) => { c.hidden = !all && i >= COLLAPSE_AT; });
  if (btn) { btn.hidden = all; btn.textContent = `Show all ${cards.length}`; }
}

function render(list: HTMLElement, order: HTMLElement[], byArea: boolean): void {
  list.querySelectorAll(':scope > .help-group-head').forEach((h) => h.remove());
  let ordered = order;
  if (byArea) {
    const area = (c: HTMLElement) => c.dataset.area || '￿';
    ordered = [...order].sort((a, b) => area(a).localeCompare(area(b), 'en', { numeric: true }));
  }
  let last: string | undefined;
  for (const c of ordered) {
    if (byArea && c.dataset.area !== last) {
      last = c.dataset.area;
      const h = document.createElement('li');
      h.className = 'help-group-head';
      h.textContent = c.dataset.areaLabel || last || 'Other areas';
      list.append(h);
    }
    list.append(c);
  }
  if (byArea) { list.dataset.expanded = '1'; }
  collapse(list);
}

async function lookup(postcodes: string[]): Promise<Map<string, { lat: number; lon: number }>> {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postcodes }) });
  if (!res.ok) throw new Error(`postcodes.io ${res.status}`);
  const body = await res.json() as { result: { query: string; result: { latitude: number; longitude: number } | null }[] };
  const out = new Map<string, { lat: number; lon: number }>();
  for (const r of body.result ?? []) if (r.result) out.set(r.query.toUpperCase(), { lat: r.result.latitude, lon: r.result.longitude });
  return out;
}

const fmtDistance = (km: number) => `${(km / 1.609).toFixed(km < 16 ? 1 : 0)} mi`;

export function init(doc: Document = document): void {
  const tz = doc.documentElement.dataset.timezone || 'UTC';
  const tick = () => markToday(doc, townWeekday(new Date(), tz));
  tick();
  setInterval(tick, 60_000);
  const lists = [...doc.querySelectorAll<HTMLElement>('[data-help-list]')];
  const byName = new Map(lists.map((l) => [l, cardsOf(l)]));
  let current = new Map(byName);
  let byArea = false;
  lists.forEach((l) => collapse(l));
  doc.querySelectorAll<HTMLButtonElement>('[data-help-more]').forEach((b) => b.addEventListener('click', () => {
    const list = b.parentElement?.querySelector<HTMLElement>('[data-help-list]');
    if (list) { list.dataset.expanded = '1'; collapse(list); }
  }));
  const group = doc.querySelector<HTMLButtonElement>('[data-help-group]');
  if (group) {
    group.hidden = false;
    group.addEventListener('click', () => {
      byArea = !byArea;
      group.setAttribute('aria-pressed', String(byArea));
      lists.forEach((l) => render(l, current.get(l) ?? [], byArea));
    });
  }
  const form = doc.querySelector<HTMLFormElement>('[data-help-postcode]');
  if (!form) return;
  form.hidden = false;
  const status = form.querySelector<HTMLElement>('[data-help-postcode-status]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = form.querySelector<HTMLInputElement>('input')!;
    const pc = input.value.trim().toUpperCase();
    if (!pc) return;
    const all = lists.flatMap((l) => byName.get(l) ?? []);
    const wanted = [pc, ...new Set(all.map((c) => (c.dataset.postcode || '').toUpperCase()).filter(Boolean))].slice(0, 100);
    let points: Map<string, { lat: number; lon: number }> | null = null;
    try { points = await lookup(wanted); } catch { points = null; }
    const from = points?.get(pc);
    current = new Map(lists.map((l) => {
      const cards = byName.get(l) ?? [];
      cards.forEach((c) => c.querySelector('[data-help-distance]')?.remove());
      if (from && points) {
        const pts = cards.map((c) => ({ c, ...(points!.get((c.dataset.postcode || '').toUpperCase()) ?? { lat: null, lon: null }) }));
        const sorted = sortByDistance(pts, from);
        for (const p of sorted) {
          if (p.lat == null || p.lon == null) continue;
          const d = distanceKm(from, { lat: p.lat, lon: p.lon });
          const el = doc.createElement('span');
          el.dataset.helpDistance = '';
          el.className = 'help-distance';
          el.textContent = fmtDistance(d);
          p.c.querySelector('.help-name')?.after(el);
        }
        return [l, sorted.map((p) => p.c)];
      }
      return [l, outcodeOrder(cards.map((c) => c.dataset.district || null), pc).map((i) => cards[i])];
    }));
    if (status) status.textContent = from ? `Nearest to ${pc} first` : `Couldn't look up ${pc}: same postcode district first`;
    lists.forEach((l) => render(l, current.get(l) ?? [], byArea));
  });
}

