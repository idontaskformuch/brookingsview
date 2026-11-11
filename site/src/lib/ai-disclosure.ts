/** The one statement on AI, shared by /advertising/, /editorial-policy/, /how-we-gather-this/, /about/, /terms/ (US and GB)
 *  and llms.txt. Owner wording 2026-11-11 (B6, second version): it says what the model does and makes no promise of a
 *  source check until Fas 5 is done and the old ai:* rows are validated. `projects` is false for a town without city
 *  project pages (Glasgow). scripts/verify_no_empty_messages.mjs fails on the earlier wordings (STALE_AI_CLAIMS). */
export function aiDisclosure(projects = true): string {
  const described = projects ? 'Descriptions of places and city projects, and' : 'Descriptions of places, and';
  return 'This site is built and maintained with the help of AI models. Event and meeting details are extracted from official sources by a model. '
    + `${described} the explanatory text on our pages, were written with an AI model from the sources they cite. If something is wrong, tell us and we will fix it.`;
}
