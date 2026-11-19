/** "How do I..." answer pages (Fas 3, specs/full-pages-no-ai-prose.md; owner decisions 2026-11-19). Every fact is data read from a named
 *  official source; nothing is written by a model. One page per slug and town, rendered by components/answers/CityAnswers.astro through
 *  pages/[answer].astro, and listed on the town's /how-do-i/ hub.
 *
 *  Inline text uses a tiny markup only: **bold** and [link text](href). Nothing else is interpreted (lib/city-answers.ts inlineHtml). */
export type Inline = string;

export type AnswerBlock =
  | { kind: 'p'; text: Inline; note?: boolean }
  | { kind: 'list'; items: Inline[]; className?: string }
  | { kind: 'facts'; rows: { label: Inline; value: Inline }[] }
  | { kind: 'table'; caption: string; head: string[]; rows: { th: Inline; cells: Inline[] }[] }
  | { kind: 'cols'; cols: { heading: string; blocks: AnswerBlock[] }[] }
  /** Dated lines that disappear once their date has passed (town's today), with a line for when none is left. */
  | { kind: 'dated'; intro?: Inline; items: { date: string; text: Inline }[]; none: Inline }
  /** A season: `during` up to and including `to` (town's today), `after` from the day after. */
  | { kind: 'season'; to: string; during: Inline; after: Inline; note?: boolean }
  /** A page-specific interactive part, by name (components/answers/CityAnswers.astro maps the name to its component). */
  | { kind: 'component'; name: 'brookings-trash-picker' | 'brookings-trash-holidays' };

export interface Answer {
  /** Anchor on the page. */
  id: string;
  /** The question in the resident's words (H2). */
  question: string;
  /** The answer as data (day, time, fee, address). */
  blocks: AnswerBlock[];
  /** What you do: buttons/links. */
  actions?: { label: string; href: string }[];
  /** One plain sentence for the hub and FAQPage JSON-LD (template text over the same facts). Omitted: not on the hub as a Q&A. */
  faq?: string;
  /** The source pages this answer is read from. */
  sources: { name: string; url: string }[];
  /** YYYY-MM-DD the sources were last read. Older than UNCONFIRMED_AFTER_DAYS: shown as unconfirmed. */
  checked: string;
  /** YYYY-MM-DD the sources must be read again by; a build after it warns. */
  checkAt: string;
  /** Unconfirmed regardless of age (the source itself says the facts are not out yet). */
  unconfirmed?: boolean;
}

export interface AnswerPage {
  slug: string;
  /** <title> */
  title: string;
  h1: string;
  description: string;
  answers: Answer[];
  /** About this page text (what the page is, from which sources). */
  about: Inline;
  /** Not built at all (owner: B1 is built but published only after the 1 Dec re-read). PREVIEW_DRAFTS=1 builds it locally. */
  draft?: boolean;
  /** Rendered after the answers and before About this page (a page that keeps its own sources section, Brookings' trash guide). */
  tail?: { heading: string; blocks: AnswerBlock[] };
  /** Sources and "Checked" go into About this page (default true). */
  sourcesInAbout?: boolean;
}
