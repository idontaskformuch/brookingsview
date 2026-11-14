/** Scotland's bank holidays as GOV.UK publishes them (bank-holidays-scotland.json is a verbatim copy of division "scotland" of
 *  https://www.gov.uk/bank-holidays.json, read through scrapers/polite_fetch.py). Owner 2026-11-14: which days are bank holidays,
 *  including substitute days, comes from this file only. Refresh: copy the division again and change `checkedOn`. */
import raw from './bank-holidays-scotland.json';
import type { BankHoliday } from '../../../lib/holiday-season';
import type { Source } from '../../../lib/holiday-page';

export const SCOTLAND_BANK_HOLIDAYS: BankHoliday[] = raw.events;
export const BANK_HOLIDAYS_SOURCE: Source = raw.source;
export const BANK_HOLIDAYS_CHECKED: string = raw.checkedOn;
