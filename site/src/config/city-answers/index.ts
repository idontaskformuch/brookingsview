/** Answer pages per town (Fas 3). A town without pages has no /how-do-i/ hub and no answer routes. */
import type { AnswerPage } from './types';
import { MORENO_VALLEY_ANSWERS } from './moreno_valley_ca';

export const CITY_ANSWERS: Record<string, AnswerPage[]> = {
  moreno_valley_ca: MORENO_VALLEY_ANSWERS,
};

/** The town's pages; drafts only when `withDrafts` (PREVIEW_DRAFTS=1 locally). */
export function answerPagesFor(townId: string, withDrafts = false): AnswerPage[] {
  return (CITY_ANSWERS[townId] ?? []).filter((p) => withDrafts || !p.draft);
}
