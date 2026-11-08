/** The country's wording for the events summary (strings/{us,gb}/events.json). `hero_min_count`: below this many things today the count is an
 *  ordinary heading, not the big hero number (owner 2026-11-08: a giant "1" says nothing). */
import us from '../../../strings/us/events.json';
import gb from '../../../strings/gb/events.json';

export const eventsStrings = (country: 'us' | 'gb' | undefined) => (country === 'gb' ? gb : us);

export const thingsOnToday = (n: number, country: 'us' | 'gb' | undefined): string => {
  const s = eventsStrings(country);
  return n === 1 ? s.things_on_today_one : s.things_on_today_many;
};
