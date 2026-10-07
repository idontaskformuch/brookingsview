/**
 * Holiday photo pool for the "This week" segment -- an overlay on TOP of
 * config/this-week-images.ts's seasonal pool, not a replacement: see
 * lib/holidays.ts's resolveActiveHoliday() for how a given week decides
 * "holiday pool" vs "season pool" (holiday wins when the week's own date
 * range overlaps an ACTIVE holiday's window; season pool otherwise, and as
 * the fallback when a holiday is active but its town's pool is empty --
 * warn, never throw, same reasoning as a thin season pool).
 *
 * LEVEL 1 (active: true, sourced first): halloween, thanksgiving, christmas
 * -- see scripts/source_this_week_images.py's HOLIDAY_QUERIES.
 *
 * LEVEL 2 (active: false): entries exist so the date-rule/window machinery
 * is already correct and tested for all of them, but NONE are live until a
 * real curated pool exists for each -- new_years, valentines, easter,
 * memorial_day, july_4, labor_day, veterans_day. Deliberately NOT
 * included at all: Mother's Day, Father's Day (per the 2026-10 review
 * instruction -- not every nth-weekday US holiday needs a pool, only the
 * ones with a real homepage-visual case for one).
 */
import type { Town } from './category-images';

export type HolidayId =
  | 'halloween' | 'thanksgiving' | 'christmas'
  | 'new_years' | 'valentines' | 'easter' | 'memorial_day' | 'july_4' | 'labor_day' | 'veterans_day';

/** `kind: 'fixed'` -- same month/day every year (Halloween, Christmas,
 *  New Year's, Valentine's, July 4th, Veterans Day).
 *  `kind: 'nth_weekday'` -- the Nth occurrence of `weekday` (0=Sunday,
 *  matching JS Date.getDay()) in `month`; `n` negative counts from the end
 *  (Thanksgiving = November, Thursday, n=4; Memorial Day = May, Monday,
 *  n=-1 i.e. the LAST Monday; Labor Day = September, Monday, n=1).
 *  `kind: 'easter'` -- the anonymous Gregorian algorithm (Meeus/Jones/
 *  Butcher), the one real movable feast this pool needs. */
export type HolidayDateRule =
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'nth_weekday'; month: number; weekday: number; n: number }
  | { kind: 'easter' };

export interface HolidayDefinition {
  id: HolidayId;
  label: string;
  dateRule: HolidayDateRule;
  /** Window opens this many days BEFORE the holiday's own date, running
   *  through the date itself (inclusive) -- "fönster i dagar före dagen". */
  windowDays: number;
  active: boolean;
}

export const HOLIDAYS: HolidayDefinition[] = [
  // Level 1 -- active, sourced first (2026-10-06 review instruction).
  { id: 'halloween', label: 'Halloween', dateRule: { kind: 'fixed', month: 10, day: 31 }, windowDays: 7, active: true },
  { id: 'thanksgiving', label: 'Thanksgiving', dateRule: { kind: 'nth_weekday', month: 11, weekday: 4, n: 4 }, windowDays: 7, active: true },
  { id: 'christmas', label: 'Christmas', dateRule: { kind: 'fixed', month: 12, day: 25 }, windowDays: 14, active: true },

  // Level 2 -- date/window machinery ready, inactive until a real pool exists.
  { id: 'new_years', label: "New Year's Day", dateRule: { kind: 'fixed', month: 1, day: 1 }, windowDays: 3, active: false },
  { id: 'valentines', label: "Valentine's Day", dateRule: { kind: 'fixed', month: 2, day: 14 }, windowDays: 5, active: false },
  { id: 'easter', label: 'Easter', dateRule: { kind: 'easter' }, windowDays: 7, active: false },
  { id: 'memorial_day', label: 'Memorial Day', dateRule: { kind: 'nth_weekday', month: 5, weekday: 1, n: -1 }, windowDays: 5, active: false },
  { id: 'july_4', label: 'Independence Day', dateRule: { kind: 'fixed', month: 7, day: 4 }, windowDays: 5, active: false },
  { id: 'labor_day', label: 'Labor Day', dateRule: { kind: 'nth_weekday', month: 9, weekday: 1, n: 1 }, windowDays: 5, active: false },
  { id: 'veterans_day', label: 'Veterans Day', dateRule: { kind: 'fixed', month: 11, day: 11 }, windowDays: 3, active: false },
];

export interface HolidayImage {
  /** e.g. "brookings_sd-halloween-01" -- same id scheme as ThisWeekImage,
   *  same this_week_image_usage history table (image_id is a plain string
   *  column, not scoped to season vs holiday). */
  id: string;
  path: string;
  alt: string;
  width: number;
  height: number;
  attributionText?: string;
  attributionUrl?: string;
  holiday: HolidayId;
  town_ids: Town[];
  sourcePhotoId: number;
}

/** Populated by scripts/source_this_week_images.py --apply --holiday, after
 *  montage review -- empty until that review has happened, same
 *  "never hand-add" rule as THIS_WEEK_IMAGES. */
export const HOLIDAY_IMAGES: HolidayImage[] = [
  { id: 'brookings_sd-halloween-01', path: '/assets/images/holidays/brookings_sd-halloween-01.jpg', alt: 'Halloween in Brookings, South Dakota.', width: 1200, height: 800, attributionText: 'Photo by Susanne Jutzeler, suju-foto on Pexels', attributionUrl: 'https://www.pexels.com/@suju', holiday: 'halloween', town_ids: ['brookings_sd'], sourcePhotoId: 13864868 },
  { id: 'brookings_sd-halloween-02', path: '/assets/images/holidays/brookings_sd-halloween-02.jpg', alt: 'Halloween in Brookings, South Dakota.', width: 1200, height: 800, attributionText: 'Photo by Sergey Platonov on Pexels', attributionUrl: 'https://www.pexels.com/@sergey-platonov-114873806', holiday: 'halloween', town_ids: ['brookings_sd'], sourcePhotoId: 10104562 },
  { id: 'brookings_sd-halloween-03', path: '/assets/images/holidays/brookings_sd-halloween-03.jpg', alt: 'Halloween in Brookings, South Dakota.', width: 1200, height: 800, attributionText: 'Photo by Jonathan Petersson on Pexels', attributionUrl: 'https://www.pexels.com/@grizzlybear', holiday: 'halloween', town_ids: ['brookings_sd'], sourcePhotoId: 18783459 },
  { id: 'brookings_sd-halloween-04', path: '/assets/images/holidays/brookings_sd-halloween-04.jpg', alt: 'Halloween in Brookings, South Dakota.', width: 1200, height: 800, attributionText: 'Photo by olia danilevich on Pexels', attributionUrl: 'https://www.pexels.com/@olia-danilevich', holiday: 'halloween', town_ids: ['brookings_sd'], sourcePhotoId: 5490805 },
  { id: 'brookings_sd-halloween-05', path: '/assets/images/holidays/brookings_sd-halloween-05.jpg', alt: 'Halloween in Brookings, South Dakota.', width: 1200, height: 800, attributionText: 'Photo by Yaroslav Shuraev on Pexels', attributionUrl: 'https://www.pexels.com/@yaroslav-shuraev', holiday: 'halloween', town_ids: ['brookings_sd'], sourcePhotoId: 5604237 },
  { id: 'brookings_sd-halloween-06', path: '/assets/images/holidays/brookings_sd-halloween-06.jpg', alt: 'Halloween in Brookings, South Dakota.', width: 1200, height: 800, attributionText: 'Photo by Dominik Gryzbon on Pexels', attributionUrl: 'https://www.pexels.com/@gryziu', holiday: 'halloween', town_ids: ['brookings_sd'], sourcePhotoId: 31222645 },
  { id: 'brookings_sd-thanksgiving-01', path: '/assets/images/holidays/brookings_sd-thanksgiving-01.jpg', alt: 'Thanksgiving in Brookings, South Dakota.', width: 1200, height: 800, attributionText: 'Photo by Jill Wellington on Pexels', attributionUrl: 'https://www.pexels.com/@jill-wellington-1638660', holiday: 'thanksgiving', town_ids: ['brookings_sd'], sourcePhotoId: 5358864 },
  { id: 'brookings_sd-thanksgiving-02', path: '/assets/images/holidays/brookings_sd-thanksgiving-02.jpg', alt: 'Thanksgiving in Brookings, South Dakota.', width: 1200, height: 800, attributionText: 'Photo by https://kaboompics.com/ on Pexels', attributionUrl: 'https://www.pexels.com/@karola-g', holiday: 'thanksgiving', town_ids: ['brookings_sd'], sourcePhotoId: 5706426 },
  { id: 'brookings_sd-thanksgiving-03', path: '/assets/images/holidays/brookings_sd-thanksgiving-03.jpg', alt: 'Thanksgiving in Brookings, South Dakota.', width: 1200, height: 800, attributionText: 'Photo by Erik Mclean on Pexels', attributionUrl: 'https://www.pexels.com/@introspectivedsgn', holiday: 'thanksgiving', town_ids: ['brookings_sd'], sourcePhotoId: 9901527 },
  { id: 'brookings_sd-thanksgiving-04', path: '/assets/images/holidays/brookings_sd-thanksgiving-04.jpg', alt: 'Thanksgiving in Brookings, South Dakota.', width: 1200, height: 800, attributionText: 'Photo by Monstera Production on Pexels', attributionUrl: 'https://www.pexels.com/@gabby-k', holiday: 'thanksgiving', town_ids: ['brookings_sd'], sourcePhotoId: 5876784 },
  { id: 'brookings_sd-thanksgiving-05', path: '/assets/images/holidays/brookings_sd-thanksgiving-05.jpg', alt: 'Thanksgiving in Brookings, South Dakota.', width: 1200, height: 800, attributionText: 'Photo by RDNE Stock project on Pexels', attributionUrl: 'https://www.pexels.com/@rdne', holiday: 'thanksgiving', town_ids: ['brookings_sd'], sourcePhotoId: 5848011 },
  { id: 'brookings_sd-thanksgiving-06', path: '/assets/images/holidays/brookings_sd-thanksgiving-06.jpg', alt: 'Thanksgiving in Brookings, South Dakota.', width: 1200, height: 800, attributionText: 'Photo by Craig Adderley on Pexels', attributionUrl: 'https://www.pexels.com/@thatguycraig000', holiday: 'thanksgiving', town_ids: ['brookings_sd'], sourcePhotoId: 1682697 },
  { id: 'moreno_valley_ca-halloween-01', path: '/assets/images/holidays/moreno_valley_ca-halloween-01.jpg', alt: 'Halloween in Moreno Valley, California.', width: 1200, height: 800, attributionText: 'Photo by Erik Mclean on Pexels', attributionUrl: 'https://www.pexels.com/@introspectivedsgn', holiday: 'halloween', town_ids: ['moreno_valley_ca'], sourcePhotoId: 29052536 },
  { id: 'moreno_valley_ca-halloween-02', path: '/assets/images/holidays/moreno_valley_ca-halloween-02.jpg', alt: 'Halloween in Moreno Valley, California.', width: 1200, height: 800, attributionText: 'Photo by Mathias Reding on Pexels', attributionUrl: 'https://www.pexels.com/@matreding', holiday: 'halloween', town_ids: ['moreno_valley_ca'], sourcePhotoId: 10011944 },
  { id: 'moreno_valley_ca-halloween-03', path: '/assets/images/holidays/moreno_valley_ca-halloween-03.jpg', alt: 'Halloween in Moreno Valley, California.', width: 1200, height: 800, attributionText: 'Photo by Brett Sayles on Pexels', attributionUrl: 'https://www.pexels.com/@brett-sayles', holiday: 'halloween', town_ids: ['moreno_valley_ca'], sourcePhotoId: 1587462 },
  { id: 'moreno_valley_ca-halloween-04', path: '/assets/images/holidays/moreno_valley_ca-halloween-04.jpg', alt: 'Halloween in Moreno Valley, California.', width: 1200, height: 800, attributionText: 'Photo by Vitaliy Haiduk on Pexels', attributionUrl: 'https://www.pexels.com/@vitaliy-haiduk-326720599', holiday: 'halloween', town_ids: ['moreno_valley_ca'], sourcePhotoId: 16018842 },
  { id: 'moreno_valley_ca-halloween-05', path: '/assets/images/holidays/moreno_valley_ca-halloween-05.jpg', alt: 'Halloween in Moreno Valley, California.', width: 1200, height: 800, attributionText: 'Photo by Soly Moses on Pexels', attributionUrl: 'https://www.pexels.com/@solyartphotos', holiday: 'halloween', town_ids: ['moreno_valley_ca'], sourcePhotoId: 13620529 },
  { id: 'moreno_valley_ca-halloween-06', path: '/assets/images/holidays/moreno_valley_ca-halloween-06.jpg', alt: 'Halloween in Moreno Valley, California.', width: 1200, height: 800, attributionText: 'Photo by Circe Denyer on Pexels', attributionUrl: 'https://www.pexels.com/@circe-denyer-164300', holiday: 'halloween', town_ids: ['moreno_valley_ca'], sourcePhotoId: 33685124 },
  { id: 'moreno_valley_ca-thanksgiving-01', path: '/assets/images/holidays/moreno_valley_ca-thanksgiving-01.jpg', alt: 'Thanksgiving in Moreno Valley, California.', width: 1200, height: 800, attributionText: 'Photo by Pixabay on Pexels', attributionUrl: 'https://www.pexels.com/@pixabay', holiday: 'thanksgiving', town_ids: ['moreno_valley_ca'], sourcePhotoId: 219794 },
  { id: 'moreno_valley_ca-thanksgiving-02', path: '/assets/images/holidays/moreno_valley_ca-thanksgiving-02.jpg', alt: 'Thanksgiving in Moreno Valley, California.', width: 1200, height: 800, attributionText: 'Photo by RDNE Stock project on Pexels', attributionUrl: 'https://www.pexels.com/@rdne', holiday: 'thanksgiving', town_ids: ['moreno_valley_ca'], sourcePhotoId: 7282207 },
  { id: 'moreno_valley_ca-thanksgiving-03', path: '/assets/images/holidays/moreno_valley_ca-thanksgiving-03.jpg', alt: 'Thanksgiving in Moreno Valley, California.', width: 1200, height: 800, attributionText: 'Photo by Silvia Macedo Decorações on Pexels', attributionUrl: 'https://www.pexels.com/@silvia-macedo-decoracoes-2151923519', holiday: 'thanksgiving', town_ids: ['moreno_valley_ca'], sourcePhotoId: 32385046 },
  { id: 'moreno_valley_ca-thanksgiving-04', path: '/assets/images/holidays/moreno_valley_ca-thanksgiving-04.jpg', alt: 'Thanksgiving in Moreno Valley, California.', width: 1200, height: 800, attributionText: 'Photo by Keith Cassill on Pexels', attributionUrl: 'https://www.pexels.com/@inspired2love', holiday: 'thanksgiving', town_ids: ['moreno_valley_ca'], sourcePhotoId: 34806355 },
  { id: 'moreno_valley_ca-thanksgiving-05', path: '/assets/images/holidays/moreno_valley_ca-thanksgiving-05.jpg', alt: 'Thanksgiving in Moreno Valley, California.', width: 1200, height: 800, attributionText: 'Photo by Susanne Jutzeler, suju-foto on Pexels', attributionUrl: 'https://www.pexels.com/@suju', holiday: 'thanksgiving', town_ids: ['moreno_valley_ca'], sourcePhotoId: 18239077 },
  { id: 'moreno_valley_ca-thanksgiving-06', path: '/assets/images/holidays/moreno_valley_ca-thanksgiving-06.jpg', alt: 'Thanksgiving in Moreno Valley, California.', width: 1200, height: 800, attributionText: 'Photo by KATRIN  BOLOVTSOVA on Pexels', attributionUrl: 'https://www.pexels.com/@ekaterina-bolovtsova', holiday: 'thanksgiving', town_ids: ['moreno_valley_ca'], sourcePhotoId: 5702781 },
  { id: 'broomfield_co-halloween-01', path: '/assets/images/holidays/broomfield_co-halloween-01.jpg', alt: 'Halloween in Broomfield, Colorado.', width: 1200, height: 800, attributionText: 'Photo by Noel Aph on Pexels', attributionUrl: 'https://www.pexels.com/@noelace', holiday: 'halloween', town_ids: ['broomfield_co'], sourcePhotoId: 28955975 },
  { id: 'broomfield_co-halloween-02', path: '/assets/images/holidays/broomfield_co-halloween-02.jpg', alt: 'Halloween in Broomfield, Colorado.', width: 1200, height: 800, attributionText: 'Photo by Sergey Platonov on Pexels', attributionUrl: 'https://www.pexels.com/@sergey-platonov-114873806', holiday: 'halloween', town_ids: ['broomfield_co'], sourcePhotoId: 10104566 },
  { id: 'broomfield_co-halloween-03', path: '/assets/images/holidays/broomfield_co-halloween-03.jpg', alt: 'Halloween in Broomfield, Colorado.', width: 1200, height: 800, attributionText: 'Photo by Frank Schrader on Pexels', attributionUrl: 'https://www.pexels.com/@franki-frank', holiday: 'halloween', town_ids: ['broomfield_co'], sourcePhotoId: 28994217 },
  { id: 'broomfield_co-halloween-04', path: '/assets/images/holidays/broomfield_co-halloween-04.jpg', alt: 'Halloween in Broomfield, Colorado.', width: 1200, height: 800, attributionText: 'Photo by Terrence Henry on Pexels', attributionUrl: 'https://www.pexels.com/@terrence-henry-305304', holiday: 'halloween', town_ids: ['broomfield_co'], sourcePhotoId: 34323907 },
  { id: 'broomfield_co-halloween-05', path: '/assets/images/holidays/broomfield_co-halloween-05.jpg', alt: 'Halloween in Broomfield, Colorado.', width: 1200, height: 800, attributionText: 'Photo by Monstera Production on Pexels', attributionUrl: 'https://www.pexels.com/@gabby-k', holiday: 'halloween', town_ids: ['broomfield_co'], sourcePhotoId: 5634603 },
  { id: 'broomfield_co-halloween-06', path: '/assets/images/holidays/broomfield_co-halloween-06.jpg', alt: 'Halloween in Broomfield, Colorado.', width: 1200, height: 800, attributionText: 'Photo by Skyler Ewing on Pexels', attributionUrl: 'https://www.pexels.com/@skyler-ewing-266953', holiday: 'halloween', town_ids: ['broomfield_co'], sourcePhotoId: 5744302 },
  { id: 'broomfield_co-thanksgiving-01', path: '/assets/images/holidays/broomfield_co-thanksgiving-01.jpg', alt: 'Thanksgiving in Broomfield, Colorado.', width: 1200, height: 800, attributionText: 'Photo by Alice Silver on Pexels', attributionUrl: 'https://www.pexels.com/@alice-silver-3314323', holiday: 'thanksgiving', town_ids: ['broomfield_co'], sourcePhotoId: 9953716 },
  { id: 'broomfield_co-thanksgiving-02', path: '/assets/images/holidays/broomfield_co-thanksgiving-02.jpg', alt: 'Thanksgiving in Broomfield, Colorado.', width: 1200, height: 800, attributionText: 'Photo by Anastasia  Shuraeva on Pexels', attributionUrl: 'https://www.pexels.com/@anastasia-shuraeva', holiday: 'thanksgiving', town_ids: ['broomfield_co'], sourcePhotoId: 6232493 },
  { id: 'broomfield_co-thanksgiving-03', path: '/assets/images/holidays/broomfield_co-thanksgiving-03.jpg', alt: 'Thanksgiving in Broomfield, Colorado.', width: 1200, height: 800, attributionText: 'Photo by Monstera Production on Pexels', attributionUrl: 'https://www.pexels.com/@gabby-k', holiday: 'thanksgiving', town_ids: ['broomfield_co'], sourcePhotoId: 5876742 },
  { id: 'broomfield_co-thanksgiving-04', path: '/assets/images/holidays/broomfield_co-thanksgiving-04.jpg', alt: 'Thanksgiving in Broomfield, Colorado.', width: 1200, height: 800, attributionText: 'Photo by Sóc Năng Động on Pexels', attributionUrl: 'https://www.pexels.com/@soc-nang-d-ng-2150345854', holiday: 'thanksgiving', town_ids: ['broomfield_co'], sourcePhotoId: 35692185 },
  { id: 'broomfield_co-thanksgiving-05', path: '/assets/images/holidays/broomfield_co-thanksgiving-05.jpg', alt: 'Thanksgiving in Broomfield, Colorado.', width: 1200, height: 800, attributionText: 'Photo by RDNE Stock project on Pexels', attributionUrl: 'https://www.pexels.com/@rdne', holiday: 'thanksgiving', town_ids: ['broomfield_co'], sourcePhotoId: 5848148 },
];

export function holidayImagesFor(townId: string, holiday: HolidayId): HolidayImage[] {
  return HOLIDAY_IMAGES.filter((img) => img.town_ids.includes(townId as Town) && img.holiday === holiday);
}
