/** Academic-calendar rows come in two kinds the reader acts on differently: a day off (nothing to do) and a deadline (something to do by then).
 *  Decided from the TITLE by plain rules; anything else, or a title that matches both, stays neutral -- a wrong label would tell the reader to act
 *  (or not to) on a guess. Tested against every title in academic_calendar_dates (lib/academic-kind.test.ts). */
export type AcademicKind = 'free' | 'deadline' | null;

const FREE = /\b(holiday|recess|break|no classes)\b/i;
const DEADLINE = /\b(last day|due|payment|deadline)\b/i;

export function academicKind(title: string): AcademicKind {
  const free = FREE.test(title);
  const deadline = DEADLINE.test(title);
  if (free === deadline) return null; // neither, or both (ambiguous)
  return free ? 'free' : 'deadline';
}

/** Word printed next to the dot; a neutral row has none. */
export const ACADEMIC_KIND_LABEL: Record<Exclude<AcademicKind, null>, string> = { free: 'Day off', deadline: 'Deadline' };
