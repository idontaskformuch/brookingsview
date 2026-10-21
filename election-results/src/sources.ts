/** Turns a town's configured source into a Snapshot. All I/O goes through the injected `f`. */
import { fetchSdCounty } from './fetch/sd';
import { checkBroomfieldCountyFeed, fetchClarity, resolveColoradoStateEvent } from './fetch/clarity';
import type { Snapshot } from './types';
import type { TownElection } from './towns';

export type SourceKind = 'sd_xlsx' | 'clarity_state' | 'clarity_county';

export interface SourceReading {
  kind: SourceKind;
  snapshot: Snapshot;
  /** Stored verbatim in election_snapshots.raw_payload. */
  raw: Uint8Array;
}

/** M/D/YYYY (Clarity) -> YYYY-MM-DD. */
function ymdFromUs(s: string | null): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s ?? '');
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

export async function readSource(town: TownElection, now: Date, f: typeof fetch = fetch): Promise<SourceReading | null> {
  const date = town.cadence.electionDate;
  const fetchedAt = now.toISOString();
  const src = town.source;

  if (src.kind === 'sd_xlsx') {
    const r = await fetchSdCounty({ county: src.county, expectedElectionDate: date, fetchImpl: f });
    return {
      kind: 'sd_xlsx',
      raw: r.raw,
      snapshot: {
        townId: town.townId, electionDate: date, sourceUrl: r.sourceUrl, sourceUpdatedAt: r.sourceUpdatedAt, fetchedAt,
        precinctsReported: r.workbook.precinctsReported, precinctsTotal: r.workbook.precinctsTotal,
        contests: r.workbook.contests,
        turnout: { ballotsCounted: null, registered: null, precinctsReporting: r.workbook.precinctsReported, precinctsTotal: r.workbook.precinctsTotal },
      },
    };
  }

  if (src.kind === 'clarity_co') {
    // The county's own Clarity site takes over automatically the moment it lists the election.
    const feed = await checkBroomfieldCountyFeed(date, f);
    if (feed.status === 'needs-review') console.error('election: Broomfield elections.json has entries that could not be matched -- needs a human', feed.raw.slice(0, 500));
    let base: string | null;
    let kind: SourceKind;
    if (feed.status === 'ready') { base = feed.base; kind = 'clarity_county'; }
    else { base = await resolveColoradoStateEvent(f); kind = 'clarity_state'; }
    if (!base) return null;

    const c = await fetchClarity(base, f);
    const eventDate = ymdFromUs(c.detail.electionDate);
    if (eventDate !== date) throw new Error(`clarity: event ${base} is for ${eventDate}, expected ${date}; refusing`);
    const row = c.detail.counties.find((x) => x.county === src.county);
    return {
      kind,
      raw: new TextEncoder().encode(c.rawSummary),
      snapshot: {
        townId: town.townId, electionDate: date, sourceUrl: c.sourceUrl, sourceUpdatedAt: c.detail.timestamp, fetchedAt,
        precinctsReported: row?.precinctsReported ?? null, precinctsTotal: row?.precinctsParticipating ?? null,
        contests: c.contests,
        turnout: row
          ? { ballotsCounted: row.ballotsCast, registered: row.totalVoters, precinctsReporting: row.precinctsReported, precinctsTotal: row.precinctsParticipating }
          : undefined,
      },
    };
  }

  return null; // link_only
}
