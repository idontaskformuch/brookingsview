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
  | { kind: 'component'; name: 'brookings-trash-picker' | 'brookings-trash-holidays' }
  /** The page's `facility` as fact rows (Where, Hours, Who, Cost): the same fields that make the <title> and the meta description
   *  (lib/answer-facility.ts facilityRows), so the page and its meta cannot differ (owner order 2026-11-26 (11)). */
  | { kind: 'facility-facts' }
  /** The page's `facility.closed` as dated lines, as `dated` (past dates drop off), from the same field the meta's "Next closed" reads. */
  | { kind: 'facility-closed'; intro?: Inline; none: Inline };

/** Hours as data: the days (0 = Sunday .. 6 = Saturday) and one opening and closing time ("13:00", "17:00"). */
export interface FacilityHours { days: number[]; from: string; to: string }

/** A facility or service a page is about, as data (owner order 2026-11-26 (11), first page: Broomfield's leaf and branch drop-off). The page's
 *  visible fact rows, FAQ sentence, <title> and meta description are all made from these fields (lib/answer-facility.ts); nothing is parsed
 *  from free text. */
export interface AnswerFacility {
  /** The facility as the title names it: "<Town> <name>: Hours & Rules (<year>)". */
  name: string;
  /** The place as the Where row names it ("Tree Branch Recycling Facility"). */
  place: string;
  /** The street address as the page writes it ("2990 W 124th Avenue"); the meta abbreviates the street word ("Ave"). Left out when unknown. */
  street?: string;
  /** The Where row's last clause without "within " ("the Tree Branch Recycle & RV Wastewater Disposal Facility"). */
  within?: string;
  /** Who may use it: `label` ("Broomfield residents"), `only` adds " only", `detail` is the rest of the row (ends with a full stop). */
  who?: { label: string; only?: boolean; detail?: string };
  /** What it costs: `label` ("Free"), `detail` the rest of the row. */
  cost?: { label: string; detail?: string };
  hours?: FacilityHours[];
  /** After the hours on the page: "year-round, with some exceptions for holidays". */
  hoursNote?: string;
  /** Closed days (the meta's "Next closed" is the first of these within 30 days). */
  closed?: { date: string; text: Inline }[];
  /** The page has a rules part (what is accepted, limits, residency): the title says "Hours & Rules", otherwise "Hours & Address". */
  rules: boolean;
  /** What is only on the page, the meta's last sentence ("Accepted items, size limits, residency rules."). */
  rulesLine?: string;
  /** The FAQ sentence's start, before the place, address and hours ("Broomfield residents can drop off leaves, branches and yard waste for free"). */
  faqLead?: string;
  /** The page shows hours the meta does not repeat (only the source's own text, or a week that does not state all seven days): the title
   *  may say "Hours", the meta has no "Open" part. */
  hoursAsText?: boolean;
  /** Between the day groups of the "Open" part: " & " (default, the answer pages) or ", " (facility pages, owner order 2026-11-26 (15) D). */
  hoursJoin?: string;
  /** The page shows a phone number (a title with neither hours nor address says "Phone"). */
  phone?: boolean;
  /** More candidates for the meta's last sentence after `rulesLine`, in order; the first that fits is used (a facility page: its own
   *  description's first sentence, then the list of what is on the page). */
  tailOptions?: string[];
}

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
  /** <title>. Not used when the page has a `facility`: then the title is made from it (lib/answer-facility.ts). */
  title?: string;
  h1: string;
  /** Meta description. Not used when the page has a `facility`. */
  description?: string;
  /** The facility the page is about, as data: title, meta, fact rows and closed days all come from it. */
  facility?: AnswerFacility;
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
