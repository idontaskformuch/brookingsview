/** The country's short weekday and date wording (strings/{us,gb}/calendar.json). Fixed lists, not Intl, so "Sep" and "Thu" read the same on every
 *  Node/ICU version and the day-first / month-first order is one string per country: gb "8 Nov", us "Nov 8". */
import us from '../../../strings/us/calendar.json';
import gb from '../../../strings/gb/calendar.json';

type Country = 'us' | 'gb' | undefined;
const pick = (country: Country) => (country === 'gb' ? gb : us);

/** `dow` = 0 (Sunday) .. 6, as Date#getUTCDay. */
export const shortWeekday = (dow: number, country: Country): string => pick(country).weekdays_short[dow];

/** `month` is 1..12. */
export const shortMonth = (month: number, country: Country): string => pick(country).months_short[month - 1];

export const shortDate = (month: number, day: number, country: Country): string =>
  pick(country).date_short.replace('{month}', shortMonth(month, country)).replace('{day}', String(day));

/** A UTC-midnight Date that stands for a calendar day (events.ts utcMidnight) as "8 Nov" / "Nov 8". */
export const shortDateOfDay = (day: Date, country: Country): string => shortDate(day.getUTCMonth() + 1, day.getUTCDate(), country);

export const shortWeekdayOfDay = (day: Date, country: Country): string => shortWeekday(day.getUTCDay(), country);
