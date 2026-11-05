/** Dev-only, read-only: the meetings the /city-hall/ page would build for the active town (organ strings, unknown organs, dedup notes).
 *  Usage (from site/): SITE_CITY=broomfield_co npx vite-node --config vite-node.config.ts scripts/dump-meetings.ts [--all] */
import { getMeetingRowsForView } from '../src/lib/db';
import { buildMeetings, unknownBodies, agendaNote, MEETINGS_TOWNS, type DedupeNote } from '../src/lib/meetings-view';
import { siteConfig } from '../src/lib/site-config';

const cfg = MEETINGS_TOWNS[siteConfig.townId];
const rows = await getMeetingRowsForView(500);
const notes: DedupeNote[] = [];
const views = buildMeetings(rows, siteConfig.timezone, siteConfig.meetingsHaveTime, notes, cfg);
console.log(`${siteConfig.townId}: ${rows.length} rows -> ${views.length} meetings; unknown organs: ${JSON.stringify(unknownBodies(rows, cfg))}`);
for (const n of notes) console.log('dedup', JSON.stringify(n));
for (const v of views.slice(0, process.argv.includes('--all') ? 999 : 8)) {
  console.log(v.ymd, v.time ?? '-', v.bodyLabel, v.typeLabel ?? '', '|', v.location ?? '-', '| items', v.items.length, '| agenda', v.agendaUrl ?? '-', '|', agendaNote(v) ?? '', v.quorumNotice ? '(quorum)' : '');
}
