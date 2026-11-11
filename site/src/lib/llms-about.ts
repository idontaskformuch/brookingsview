/** First lines of llms.txt (GEO spec point 1.3, owner approved 2026-11-04): what the site IS and is not, what it
 *  collects and how the content is produced, so an answer engine does not present it as an official source.
 *  Wording mirrors how-we-gather-this.astro; no person, owner or employer is named here. */
import { aiDisclosure } from './ai-disclosure';

export interface LlmsAboutInput {
  siteName: string;
  place: string;
  sourceBlurb: string;
  /** The town has city project pages (false for Glasgow). */
  projects?: boolean;
}

export function llmsAboutLines(i: LlmsAboutInput): string[] {
  return [
    `> ${i.siteName} is an independent local information site for ${i.place}. It is not a government agency and not a newsroom; official decisions and notices are the ones published by the local authorities themselves.`,
    `> ${i.sourceBlurb} Pages are assembled automatically from those sources and checked by automated rules; no person reviews an individual item before it is published. ${aiDisclosure(i.projects ?? true)} Every news item and listing links back to its source. Collected twice a day; weather hourly.`,
  ];
}
