/** Markup of the ui/ components that are drawn from a plain data object, as strings. The Astro components (HeroStat, InsightLine, RangeBar,
 *  HourStrip, DayRows) call these at build time; a page script (lib/live-weather.ts) calls the same functions in the browser, so a page that
 *  is refreshed with newer data is built from the same markup as the one the build wrote. Styles live in design/ui-components.css (global,
 *  `ui-` prefixed). Every dynamic value goes through esc(); icons come only from lib/ui/icons.ts. */
import { ICONS, type IconName } from './icons';
import { pointPercent, spanPercent, tempStop, type TempUnit } from './ui-helpers';

export const esc = (v: unknown): string => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** ` name="value"` for each entry; true -> bare attribute (hidden), false/null/undefined -> left out. Same rule as Astro's spread. */
export function attrsHtml(attrs: Record<string, unknown> = {}): string {
  return Object.entries(attrs).map(([k, v]) => (v === true ? ` ${k}` : v === false || v === null || v === undefined ? '' : ` ${k}="${esc(v)}"`)).join('');
}

export function iconHtml(name: IconName, size = 20, label?: string): string {
  return `<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"${label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"'} focusable="false">${ICONS[name]}</svg>`;
}

export interface HeroProps {
  value: string | number;
  unit?: string;
  label?: string;
  sub?: string;
  /** A line of small facts under `sub` ("Feels like 41° · High 54° · Low 31°"). */
  meta?: string;
  icon?: IconName;
  iconLabel?: string;
  tone?: 'ink' | 'accent';
  rootAttrs?: Record<string, unknown>;
  valueAttrs?: Record<string, unknown>;
  unitAttrs?: Record<string, unknown>;
}
export function heroHtml(p: HeroProps): string {
  const { value, unit, label, sub, meta, icon, iconLabel, tone = 'ink', rootAttrs = {}, valueAttrs = {}, unitAttrs = {} } = p;
  return `<div class="ui-hero ui-hero--${tone}"${attrsHtml(rootAttrs)}>`
    + (label ? `<p class="ui-hero__label">${esc(label)}</p>` : '')
    + `<p class="ui-hero__value"><span${attrsHtml(valueAttrs)}>${esc(value)}</span>${unit !== undefined ? `<span class="ui-hero__unit"${attrsHtml(unitAttrs)}>${esc(unit)}</span>` : ''}${icon ? `<span class="ui-hero__icon">${iconHtml(icon, 56, iconLabel)}</span>` : ''}</p>`
    + (sub ? `<p class="ui-hero__sub">${esc(sub)}</p>` : '')
    + (meta ? `<p class="ui-hero__meta">${esc(meta)}</p>` : '')
    + '</div>';
}

/** `html` is already-escaped inner markup (the Astro wrapper passes its rendered slot); `text` is plain text. */
export function insightHtml(p: { icon?: IconName; attrs?: Record<string, unknown>; class?: string; html?: string; text?: string }): string {
  const cls = ['ui-insight', p.class].filter(Boolean).join(' ');
  return `<p class="${esc(cls)}"${attrsHtml(p.attrs)}>${p.icon ? iconHtml(p.icon, 18) : ''}<span>${p.html ?? esc(p.text)}</span></p>`;
}

export interface RangeProps { scaleMin: number; scaleMax: number; low: number; high: number; now?: number; unit: TempUnit; label?: string }
/** '' when the numbers are missing (no data, no element). */
export function rangeBarHtml(p: RangeProps): string {
  const span = spanPercent(p.scaleMin, p.scaleMax, p.low, p.high);
  if (!span) return '';
  const nowAt = p.now === undefined ? null : pointPercent(p.scaleMin, p.scaleMax, p.now);
  const text = `${p.label ? p.label + ': ' : ''}${Math.round(p.low)}° to ${Math.round(p.high)}°`;
  return `<div class="ui-range" role="img" aria-label="${esc(text)}"><span class="ui-range__lo">${Math.round(p.low)}°</span><span class="ui-range__track">`
    + `<span class="ui-range__fill" style="left:${span.left}%;width:${span.width}%;background:linear-gradient(90deg,var(--temp-${tempStop(p.low, p.unit)}),var(--temp-${tempStop(p.high, p.unit)}))"></span>`
    + (nowAt !== null ? `<span class="ui-range__now" style="left:${nowAt}%"></span>` : '')
    + `</span><span class="ui-range__hi">${Math.round(p.high)}°</span></div>`;
}

// ---- hour strip: time, icon, temperature, a thin temperature curve through the card, rain bars ----
export interface HourCell { time: string; temp: number; icon?: IconName | null; short?: string; pop?: number | null; current?: boolean }
export const HOUR_COL = 56;
const PLOT_H = 44;
const RAIN_H = 26;
const POP_LABEL_MIN = 10;
const WET = 50;
const round = (n: number) => Math.round(n * 10) / 10;

/** Smooth path through the points (midpoint quadratic segments). */
export function curvePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x} ${pts[0].y}`;
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${pts[i].x} ${pts[i].y} ${round(mx)} ${round(my)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last.x} ${last.y}`;
}

export function hourStripHtml(hours: HourCell[], unit: TempUnit, label = 'Next 24 hours'): string {
  if (hours.length === 0) return '';
  const temps = hours.map((h) => h.temp);
  const lo = Math.min(...temps), hi = Math.max(...temps), pad = 6;
  const y = (t: number) => (hi === lo ? PLOT_H / 2 : round(pad + ((hi - t) / (hi - lo)) * (PLOT_H - 2 * pad)));
  const pts = hours.map((h, i) => ({ x: i * HOUR_COL + HOUR_COL / 2, y: y(h.temp) }));
  const anyPop = hours.some((h) => typeof h.pop === 'number');
  const w = hours.length * HOUR_COL;
  const dots = hours.map((h, i) => `<circle cx="${pts[i].x}" cy="${pts[i].y}" r="3" fill="var(--temp-${tempStop(h.temp, unit)})"/>`).join('');
  const cols = hours.map((h) => {
    const pop = typeof h.pop === 'number' ? h.pop : null;
    const bar = pop === null ? '' : `<i class="ui-hr__bar${pop >= WET ? ' is-wet' : ''}" style="height:${pop > 0 ? Math.max(2, Math.round((pop / 100) * RAIN_H)) : 0}px"></i>`;
    return `<li class="ui-hr${h.current ? ' is-current' : ''}"${h.current ? ' aria-current="time"' : ''}>`
      + `<span class="ui-hr__time">${esc(h.time)}</span>`
      + `<span class="ui-hr__icon">${h.icon ? iconHtml(h.icon, 24, h.short || undefined) : ''}</span>`
      + `<span class="ui-hr__temp">${Math.round(h.temp)}°</span>`
      + '<span class="ui-hr__plot"></span>'
      + (anyPop ? `<span class="ui-hr__rain" role="img" aria-label="${pop === null ? 'No rain chance given' : `${pop}% chance of precipitation`}">${bar}</span><span class="ui-hr__pop">${pop !== null && pop >= POP_LABEL_MIN ? `${pop}%` : ''}</span>` : '')
      + '</li>';
  }).join('');
  return `<div class="ui-hours" role="region" tabindex="0" aria-label="${esc(label)} (scrollable)"><div class="ui-hours__inner" style="width:${w}px">`
    + `<svg class="ui-hours__curve" width="${w}" height="${PLOT_H}" viewBox="0 0 ${w} ${PLOT_H}" aria-hidden="true" focusable="false"><path d="${curvePath(pts)}" fill="none" stroke="var(--ink-faint)" stroke-width="1.5" stroke-linecap="round"/>${dots}</svg>`
    + `<ol class="ui-hours__list">${cols}</ol></div></div>`;
}

// ---- day rows: one row per day, range bar on the week's shared scale, details behind a tap ----
export interface DayCell {
  label: string;
  fullLabel: string;
  today?: boolean;
  icon?: IconName | null;
  short?: string;
  high: number | null;
  low: number | null;
  pop?: number | null;
  details?: { icon?: IconName; label: string; value: string }[];
}
export function dayRowsHtml(days: DayCell[], scale: { min: number; max: number } | null, unit: TempUnit, label = 'Week ahead', attrs: Record<string, unknown> = {}): string {
  if (days.length === 0) return '';
  const rows = days.map((d) => {
    const bar = d.high !== null && d.low !== null && scale
      ? rangeBarHtml({ scaleMin: scale.min, scaleMax: scale.max, low: d.low, high: d.high, unit, label: d.fullLabel })
      : `<span class="ui-wd__single">${d.high !== null ? `High ${Math.round(d.high)}°` : `Low ${Math.round(d.low as number)}°`}</span>`;
    const more = (d.details ?? []).map((m) => `<div><dt>${m.icon ? iconHtml(m.icon, 16) : ''}${esc(m.label)}</dt><dd>${esc(m.value)}</dd></div>`).join('');
    const summary = `<span class="ui-wd__name">${esc(d.label)}</span>`
      + `<span class="ui-wd__icon">${d.icon ? iconHtml(d.icon, 24, d.short || undefined) : ''}</span>`
      + `<span class="ui-wd__bar">${bar}</span>`
      + `<span class="ui-wd__pop">${typeof d.pop === 'number' ? `${iconHtml('droplet', 14)}<span>${d.pop}%</span>` : ''}</span>`;
    const body = more ? `<details><summary>${summary}</summary><dl class="ui-wd__more">${more}</dl></details>` : `<div class="ui-wd__flat">${summary}</div>`;
    return `<li class="ui-wd${d.today ? ' is-today' : ''}">${body}</li>`;
  }).join('');
  return `<ol class="ui-weekdays" aria-label="${esc(label)}"${attrsHtml(attrs)}>${rows}</ol>`;
}

/** Heading for a block: serif title, optional kicker above and a "See all" link at the right. */
export function sectionHeaderHtml(p: { title: string; kicker?: string; seeAllHref?: string; seeAllLabel?: string; level?: 2 | 3 }): string {
  const h = `h${p.level ?? 2}`;
  return `<header class="ui-sh"><div>${p.kicker ? `<p class="ui-sh__kicker">${esc(p.kicker)}</p>` : ''}<${h} class="ui-sh__title">${esc(p.title)}</${h}></div>`
    + `${p.seeAllHref ? `<a class="ui-sh__all" href="${esc(p.seeAllHref)}">${esc(p.seeAllLabel ?? 'See all')}</a>` : ''}</header>`;
}
