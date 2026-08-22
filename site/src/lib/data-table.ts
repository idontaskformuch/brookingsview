/**
 * Shared sort/filter/pagination behavior for the site's plain HTML data
 * tables (Home sales, Jobs, Traffic) -- see NEEDS-HUMAN-REVIEW.md "4.1
 * Shared table component". Progressive enhancement over a server-rendered
 * `<table>`, not a framework component: these pages are static HTML with a
 * `<script>` tag, so "one component" here means one shared behavior module
 * each page configures for its own columns, not one Astro component trying
 * to render three differently-shaped tables. Column sets genuinely differ
 * (Home sales: date/address/price; Jobs: title/company/category/salary/
 * posted; Traffic: severity/road/details/updated) -- unifying the columns
 * themselves would force a worse, more generic table, not a better one.
 *
 * Accessible by construction: operates on a real `<table>` with `<th
 * scope="col">` headers already in the server-rendered markup (every
 * table using this already has them) -- this module only adds click/
 * keyboard handlers and visibility toggles, never changes the underlying
 * semantics. Sortable headers are real, focusable, keyboard-activatable
 * buttons (see makeHeaderSortable), not bare click handlers on a `<th>`.
 */

export interface FilterConfig {
  /** <select> element id. */
  selectId: string;
  /** data-* attribute (without "data-") on each <tr> to match against the select's value. */
  attr: string;
}

export interface DataTableOptions {
  tableId: string;
  /** Zero or more dropdown filters -- a row must match ALL of them to stay visible. */
  filters?: FilterConfig[];
  /** Dropdown-driven sort (Jobs' "Sort by" pattern) -- maps a <select> value to a numeric data-* key + direction. */
  sortSelect?: { selectId: string; keys: Record<string, { attr: string; dir: 1 | -1 }> };
  /** Click-to-sort column headers (Home sales' pattern) -- reads data-sort="key" off each <th>. */
  sortableHeaders?: boolean;
  pageSizeId?: string;
  statusId?: string;
  /** Text builder for the status line; defaults to "Showing N of M". */
  statusText?: (shown: number, total: number) => string;
}

export function initDataTable(opts: DataTableOptions): void {
  const table = document.getElementById(opts.tableId);
  if (!table) return;
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr'));

  const filterSelects = (opts.filters ?? []).map((f) => ({
    el: document.getElementById(f.selectId) as HTMLSelectElement | null,
    attr: f.attr,
  }));
  const sortSelectEl = opts.sortSelect
    ? (document.getElementById(opts.sortSelect.selectId) as HTMLSelectElement | null)
    : null;
  const pageSizeEl = opts.pageSizeId
    ? (document.getElementById(opts.pageSizeId) as HTMLSelectElement | null)
    : null;
  const statusEl = opts.statusId ? document.getElementById(opts.statusId) : null;
  const statusText = opts.statusText ?? ((shown: number, total: number) => `Showing ${shown} of ${total}`);

  let headerSortKey: string | null = null;
  let headerSortDir: 1 | -1 = -1;

  function apply() {
    let visible = rows.filter((r) =>
      filterSelects.every(({ el, attr }) => !el || !el.value || r.dataset[attr] === el.value),
    );

    if (headerSortKey) {
      visible = visible.slice().sort((a, b) => {
        const av = Number(a.dataset[headerSortKey!] || 0);
        const bv = Number(b.dataset[headerSortKey!] || 0);
        return (av - bv) * headerSortDir;
      });
    } else if (opts.sortSelect && sortSelectEl) {
      const cfg = opts.sortSelect.keys[sortSelectEl.value];
      if (cfg) {
        visible = visible.slice().sort((a, b) => {
          const av = a.dataset[cfg.attr] || '';
          const bv = b.dataset[cfg.attr] || '';
          const an = Number(av), bn = Number(bv);
          const cmp = !Number.isNaN(an) && !Number.isNaN(bn) && (av !== '' || bv !== '')
            ? an - bn
            : av.localeCompare(bv);
          return cmp * cfg.dir;
        });
      }
    }

    const limit = pageSizeEl ? parseInt(pageSizeEl.value, 10) : visible.length;
    rows.forEach((r) => (r.hidden = true));
    visible.slice(0, limit).forEach((r) => {
      r.hidden = false;
      tbody!.appendChild(r); // re-order into current sort/filter order
    });

    if (statusEl) statusEl.textContent = statusText(Math.min(limit, visible.length), visible.length);
  }

  filterSelects.forEach(({ el }) => el?.addEventListener('change', apply));
  sortSelectEl?.addEventListener('change', apply);
  pageSizeEl?.addEventListener('change', apply);

  if (opts.sortableHeaders) {
    table.querySelectorAll<HTMLElement>('[data-sort]').forEach((th) => {
      // A real, focusable, keyboard-activatable control -- not a bare click
      // handler on a <th>, which a keyboard/screen-reader user could never
      // trigger.
      th.setAttribute('role', 'button');
      th.setAttribute('tabindex', '0');
      th.style.cursor = 'pointer';
      const activate = () => {
        const key = th.dataset.sort!;
        if (headerSortKey === key) headerSortDir = headerSortDir === 1 ? -1 : 1;
        else { headerSortKey = key; headerSortDir = -1; }
        apply();
      };
      th.addEventListener('click', activate);
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
    });
  }

  apply();
}
