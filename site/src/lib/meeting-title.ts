/** A meeting's stored title ends with its date ("Hillhead Area Partnership — Tue 3 Nov 2026"). A card already shows the date on its own line
 *  (owner 2026-10-28: "inget datum i rubriken när kortet visar det"), so the card title drops it; the page keeps the full title. */
const TRAILING_DATE = /\s+[—–-]\s+(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]{2,8}|[A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:st|nd|rd|th)?)(?:,?\s+\d{4})?\s*$/;

export function meetingCardTitle(title: string, sourceType: string): string {
  if (sourceType !== 'meeting') return title;
  const stripped = title.replace(TRAILING_DATE, '');
  return stripped.length >= 4 ? stripped : title;
}
