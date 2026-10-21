/** Browser behaviour for components/SectionNav.astro. Progressive enhancement:
 *  without JS the swipe row works and the "All" <details> lists every section.
 *  With JS the <details> is swapped for a real button that opens the groups as a
 *  dialog (bottom sheet on phones, anchored panel on desktop).
 *  Kept out of the component so a test can run the real code in real Chromium
 *  (section-nav-ui.test.ts). */

type Gtag = (cmd: string, name: string, params?: Record<string, unknown>) => void;

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function initSectionNav(root: HTMLElement, win: Window & { gtag?: Gtag } = window): () => void {
  const doc = root.ownerDocument;
  const row = root.querySelector<HTMLElement>('[data-snav-row]');
  const fallback = root.querySelector<HTMLDetailsElement>('[data-snav-fallback]');
  const btn = root.querySelector<HTMLButtonElement>('[data-snav-open]');
  const layer = root.querySelector<HTMLElement>('[data-snav-layer]');
  const sheet = root.querySelector<HTMLElement>('[data-snav-sheet]');
  const groups = root.querySelector<HTMLElement>('[data-snav-groups]');
  const closeBtn = root.querySelector<HTMLButtonElement>('[data-snav-close-btn]');
  if (!row || !fallback || !btn || !layer || !sheet || !groups || !closeBtn) return () => {};

  const track = (name: string, params: Record<string, unknown>) => {
    // Existing analytics: GA4 gtag, which only exists when the visitor has not declined (BaseLayout.astro).
    try { win.gtag?.('event', name, params); } catch { /* analytics must never break navigation */ }
  };

  // --- swap the no-JS <details> for the real button + dialog
  sheet.querySelector('[data-snav-groups-slot]')!.appendChild(groups);
  fallback.hidden = true;
  btn.hidden = false;

  // --- swipe row: active tab fully visible on load, fade only while more is to the right
  const active = row.querySelector<HTMLElement>('[aria-current="page"]');
  const updateEnd = () => {
    root.classList.toggle('snav--end', row.scrollLeft + row.clientWidth >= row.scrollWidth - 2);
  };
  if (active) {
    const target = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
    row.scrollLeft = Math.max(0, target);
  }
  updateEnd();
  row.addEventListener('scroll', updateEnd, { passive: true });

  // --- desktop: tabs that do not fit are removed from the tab order (they stay reachable via All)
  const fit = () => {
    const links = [...row.querySelectorAll<HTMLElement>('a')];
    const desktop = win.matchMedia('(min-width: 56rem)').matches;
    const top = links[0]?.offsetTop ?? 0;
    for (const a of links) {
      const hidden = desktop && a.offsetTop > top + 2;
      a.tabIndex = hidden ? -1 : 0;
      a.toggleAttribute('data-snav-clipped', hidden);
      if (hidden) a.setAttribute('aria-hidden', 'true'); else a.removeAttribute('aria-hidden');
    }
  };
  fit();
  win.addEventListener('resize', fit);

  // --- tab analytics
  row.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLElement>('a[data-nav-id]');
    if (a) track('nav_tab_click', { section: a.dataset.navId, placement: 'tab' });
  });

  // --- sheet
  let open = false;
  let pushed = false;
  let restoreFocus: HTMLElement | null = null;

  const place = () => {
    const r = btn.getBoundingClientRect();
    sheet.style.setProperty('--snav-top', `${Math.round(r.bottom + 6)}px`);
  };
  const setOpen = (next: boolean) => {
    open = next;
    layer.hidden = !next;
    btn.setAttribute('aria-expanded', String(next));
    doc.documentElement.classList.toggle('snav-lock', next);
  };
  const openSheet = () => {
    if (open) return;
    restoreFocus = btn;
    place();
    setOpen(true);
    win.history.pushState({ snav: 1 }, '');
    pushed = true;
    sheet.focus();
    track('nav_all_open', {});
  };
  /** Close from the UI (button, scrim, Esc): also drop the history entry we pushed. */
  const closeSheet = () => {
    if (!open) return;
    setOpen(false);
    restoreFocus?.focus();
    if (pushed) { pushed = false; win.history.back(); }
  };
  btn.addEventListener('click', () => (open ? closeSheet() : openSheet()));
  closeBtn.addEventListener('click', closeSheet);
  layer.querySelector('[data-snav-scrim]')!.addEventListener('click', closeSheet);
  // Selecting a section: let the link navigate, just close the UI (no history.back, that would cancel it).
  sheet.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLElement>('a[data-nav-id]');
    if (!a) return;
    track('nav_tab_click', { section: a.dataset.navId, placement: 'sheet' });
    pushed = false;
    setOpen(false);
  });
  // Browser back while open closes the sheet instead of leaving the page.
  win.addEventListener('popstate', () => {
    if (open) { pushed = false; setOpen(false); restoreFocus?.focus(); }
  });
  doc.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const f = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hidden && el.offsetParent !== null);
    if (f.length === 0) return;
    const first = f[0], last = f[f.length - 1];
    const cur = doc.activeElement;
    if (e.shiftKey && (cur === first || cur === sheet)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    else if (!sheet.contains(cur)) { e.preventDefault(); first.focus(); }
  });
  win.addEventListener('resize', () => { if (open) place(); });

  return () => { setOpen(false); };
}
