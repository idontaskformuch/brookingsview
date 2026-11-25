/** Park amenities shown on the /facilities/ hub (designsystem Fas 4, Facilities, 2026-11-25): only the few a resident decides a
 *  park visit on. Each label lists the exact `places.services` values (case-insensitive) that mean it, as the sources write them
 *  (one town stores keys like `restrooms`, another the city's own words like "Modern restrooms"). A park without one of these
 *  values shows no amenity; nothing is inferred from a park's name or description. Order here is the order on the page. */
export interface ParkAmenity {
  label: string;
  sourceValues: string[];
}

export const PARK_AMENITIES: ParkAmenity[] = [
  { label: 'Playground', sourceValues: ['playground'] },
  { label: 'Restrooms', sourceValues: ['restrooms', 'modern restrooms'] },
  { label: 'Dog park', sourceValues: ['dog_park'] },
  { label: 'Dogs off leash', sourceValues: ['pets off leash'] },
];
