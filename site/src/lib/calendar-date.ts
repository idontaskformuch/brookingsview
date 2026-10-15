/** Extracted out of lib/db.ts (2026-10-15, Open/Closed badge client-side
 *  move) so this stays a genuinely dependency-free module -- db.ts does
 *  `neon(import.meta.env.DATABASE_URL)` at module load time, so anything
 *  importing a VALUE (not just a type) from db.ts drags that call into
 *  whatever bundle it ends up in. place-hours.ts needs calendarDateParts()
 *  but must be safe to import into a browser <script> (see that module's
 *  own updated comment) -- it couldn't be, as long as the only copy of
 *  this function lived inside db.ts itself. db.ts re-exports from here so
 *  every existing `import { calendarDateParts } from '../lib/db'` call
 *  site keeps working unchanged.
 *
 *  Delad extraktionslogik bakom formatCalendarDate -- se dess kommentar för
 *  varför sträng/Date måste hanteras olika. Egen export så andra sidor (t.ex.
 *  events.astro:s "matchar dagens datum mot en spelad hemmamatch") kan jämföra
 *  ett kalenderdatum mot "idag" utan att själva återuppfinna samma landmina.
 */
export function calendarDateParts(value: string | Date | null): { y: number; m: number; d: number } | null {
  if (!value) return null;
  if (value instanceof Date) {
    return { y: value.getFullYear(), m: value.getMonth(), d: value.getDate() };
  }
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return { y, m: m - 1, d };
}
