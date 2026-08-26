/**
 * Authored empty-state copy -- see NEEDS-HUMAN-REVIEW.md "Liveliness Spec",
 * §4. Hand-written constants, never generated, and they never change based
 * on data -- the whole point is that "zero results" reads as a fact stated
 * in the site's own voice, not as a database placeholder ("0 results").
 *
 * State the situation, don't apologize, don't editorialize. Empty is often
 * the correct and reassuring answer (closures, traffic) -- style it as
 * normal content, not an error or a warning.
 */
export const EMPTY_STATES = {
  schoolClosures: 'No closures. Schools are open.',
  traffic: 'Nothing closed or blocked right now.',
  eventsAll: 'Nothing on the calendar yet this week.',
  eventsToday: 'Nothing today — check back, or see everything coming up.',
  eventsWeekend: 'Nothing this weekend.',
  eventsFree: 'No free events listed this week — check back.',
  eventsKids: 'No kids or family events listed this week — check back.',
  eventsLibrary: 'No library events listed this week — check back.',
  eventsCampus: 'No campus events listed this week — check back.',
  workplaceWatch: 'No reviews summarized yet this month.',
  homeSales: 'No sales recorded in the latest county report.',
  comments: 'No comments yet.',
  searchFilter: 'Nothing matched. Try a broader filter.',
} as const;
