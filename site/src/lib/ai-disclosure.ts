/** The one sentence on model-written text, shared by /advertising/, /editorial-policy/, /how-we-gather-this/, /about/,
 *  /terms/ (US and GB) and llms.txt (owner B6, 2026-11-11): the place and project descriptions in data/facilities and
 *  data/projects were written with an AI model, so "no text is written by an AI model" was not true. Fas 5 checks each
 *  description on an indexable page against its source and removes what cannot be backed up. `projects` is false for a
 *  town without city project pages (Glasgow). */
export function aiDisclosure(projects = true): string {
  return `Some descriptions of places${projects ? ' and city projects' : ''} were written with an AI model from the official pages they cite; we check them against those pages and remove what we cannot back up. No other text on the site is written by an AI model.`;
}
