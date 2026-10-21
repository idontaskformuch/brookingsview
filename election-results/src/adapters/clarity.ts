/** Clarity Elections ENR (results.enr.clarityelections.com) -> Contest[] + turnout.
 *  Verified against Colorado's statewide June 2026 primary (event 126592): summary.json carries one
 *  entry per contest (K = contest key, C = name, CH = choices, V = votes, same order) and
 *  detail.xml carries <Timestamp> plus per-county turnout. The STATE feed has statewide totals only:
 *  no Broomfield-level votes and no local contests (checked 2026-10-21). A county-level event
 *  (CO/Broomfield/<id>/) is expected to use the same file layout; that is unverified until it exists. */
import { XMLParser } from 'fast-xml-parser';
import type { Contest } from '../types';

export interface ClarityTurnout {
  county: string;
  totalVoters: number;
  ballotsCast: number;
  precinctsParticipating: number;
  precinctsReported: number;
}

export interface ClarityDetail {
  /** The source's own timestamp as printed, e.g. "7/23/2026 4:21:16 PM MDT". */
  timestamp: string | null;
  electionName: string | null;
  /** M/D/YYYY as printed. */
  electionDate: string | null;
  counties: ClarityTurnout[];
}

interface SummaryEntry {
  K: string;
  C: string;
  CAT?: string;
  CH: string[];
  V: number[];
}

export function parseClaritySummary(json: string): Contest[] {
  const data = JSON.parse(json) as SummaryEntry[];
  if (!Array.isArray(data)) throw new Error('clarity: summary.json is not an array');
  return data.map((e) => {
    if (!Array.isArray(e.CH) || !Array.isArray(e.V) || e.CH.length !== e.V.length) {
      throw new Error(`clarity: contest ${e.K} has mismatched choices/votes`);
    }
    return {
      sourceContestId: String(e.K),
      name: e.C.replace(/\s+/g, ' ').trim(),
      party: null,
      choices: e.CH.map((name, i) => ({ name: name.replace(/\s+/g, ' ').trim(), votes: e.V[i] })),
    };
  });
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });

export function parseClarityDetail(text: string): ClarityDetail {
  const doc = xml.parse(text).ElectionResult;
  if (!doc) throw new Error('clarity: detail.xml has no ElectionResult');
  const list = doc.ElectionVoterTurnout?.Counties?.County;
  const arr: Array<Record<string, string>> = list === undefined ? [] : Array.isArray(list) ? list : [list];
  return {
    timestamp: doc.Timestamp ?? null,
    electionName: doc.ElectionName ?? null,
    electionDate: doc.ElectionDate ?? null,
    counties: arr.map((c) => ({
      county: c['@_name'],
      totalVoters: Number(c['@_totalVoters']),
      ballotsCast: Number(c['@_ballotsCast']),
      precinctsParticipating: Number(c['@_precinctsParticipating']),
      precinctsReported: Number(c['@_precinctsReported']),
    })),
  };
}

export type CountyFeed =
  | { status: 'empty' }
  /** The list has entries but none could be tied to the expected election and a base URL. Needs a human. */
  | { status: 'needs-review'; raw: string }
  | { status: 'ready'; base: string };

/** Decide whether Broomfield's own Clarity site (CO/Broomfield/elections.json) has taken over.
 *  The entry shape has never been observed (the list has been `[]`), so nothing is guessed:
 *  an entry counts only if it mentions the expected date and contains a /CO/Broomfield/<id> path. */
export function inspectCountyElections(json: string, expectedElectionDate: string): CountyFeed {
  const list = JSON.parse(json) as unknown;
  if (!Array.isArray(list) || list.length === 0) return { status: 'empty' };
  const [y, m, d] = expectedElectionDate.split('-').map(Number);
  const dateForms = [`${m}/${d}/${y}`, expectedElectionDate, `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`];
  for (const entry of list) {
    const s = JSON.stringify(entry);
    const id = /CO\/Broomfield\/(\d+)/.exec(s)?.[1];
    if (id && dateForms.some((f) => s.includes(f))) {
      return { status: 'ready', base: `https://results.enr.clarityelections.com/CO/Broomfield/${id}` };
    }
  }
  return { status: 'needs-review', raw: json };
}
