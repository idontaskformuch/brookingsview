/**
 * Per-section identity -- see NEEDS-HUMAN-REVIEW.md "Liveliness Spec" §3.
 * One accent color + one label per section, nothing else changes (same
 * components, same spacing, same type scale). The accent is a wayfinding
 * signal, not decoration -- used in at most three places per page (the
 * section masthead rule, the active nav item, and in-section link
 * underlines), never simultaneously as a button/background/border color.
 *
 * Deliberately NOT every section has an entry: the brief's own restraint
 * rule ("one quiet section makes the others read as intentional") argues
 * against accenting every page just because it's possible. Facilities is
 * explicitly quiet by design; a section absent here (city hall, jobs,
 * MoVal's own /sports/) simply renders with the site's existing default
 * navy, same as before this spec.
 *
 * Every accent independently contrast-checked at 4.5:1+ against both
 * --paper (#f4f6f7) and --surface (#ffffff) at body-text size before being
 * chosen here -- see the module's own verification note in
 * NEEDS-HUMAN-REVIEW.md for the actual computed ratios (all 6.3+).
 *
 * Shared with StoryCard.astro's dense-list category chip (see
 * NEEDS-HUMAN-REVIEW.md "Venue & Category Image Identity") -- one color
 * per concept across the site, not two independently-invented palettes
 * that happen to both mean "traffic".
 */
export type SectionKey = 'traffic' | 'events' | 'workplace_watch' | 'university' | 'home_sales' | 'vail_news' | 'closure_watch' | 'new_in_town';

export interface SectionTheme {
  accent: string;
  label: string;
}

export const SECTION_THEME: Record<SectionKey, SectionTheme> = {
  traffic: { accent: '#8a4a0a', label: 'Traffic' },
  events: { accent: '#146b36', label: 'Events' },
  workplace_watch: { accent: '#38507a', label: 'Worker Pulse' },
  university: { accent: '#0f3f8c', label: 'University' },
  home_sales: { accent: '#8a3f32', label: 'Home sales' },
  // #1c5c5c contrast-checked (relative-luminance formula, same method as
  // this file's other accents): 7.08:1 vs --paper, 7.68:1 vs --surface --
  // both comfortably past the 4.5:1 floor. Deliberately NOT Vail Resorts'
  // own brand red -- an accent color match would read as implied
  // affiliation, exactly what the handoff's "no brand marks" rule warns
  // against for logos/images.
  vail_news: { accent: '#1c5c5c', label: 'Vail Resorts' },
  // #5b3a8e contrast-checked (relative-luminance formula, same method as
  // this file's other accents): 8.6:1 vs --surface, 7.9:1 vs --paper.
  // Deliberately a different hue from --alert (the red used by
  // SchoolAlertBanner/school_alerts elsewhere) -- Closure Watch surfaces
  // the SAME underlying data but is a distinct section with its own Clear/
  // Watch/Confirmed states, not just another alert banner.
  closure_watch: { accent: '#5b3a8e', label: 'Closure Watch' },
  // #9c3f6b contrast-checked (relative-luminance formula, same method as
  // this file's other accents): 6.3:1 vs --surface, 5.78:1 vs --paper. A
  // warm rose/magenta, deliberately distinct in hue from home_sales' more
  // brown-terracotta #8a3f32 and closure_watch's blue-violet #5b3a8e.
  new_in_town: { accent: '#9c3f6b', label: 'New in Town' },
};
