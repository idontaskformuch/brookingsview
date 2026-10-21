/** South Dakota SOS county export (electionresults.sd.gov ResultsExport.aspx) -> Contest[].
 *  The export is an XLSX with one sheet per contest in a county:
 *    A1 title, A3 "Precincts N of M Reporting ...", A4 county, A5 "Downloaded at ...",
 *    row 7 = contest name (A) / "Precinct" (B) / candidates (C...), then one row per precinct,
 *    last row TOTALS. Sheet names are "<PARTY 3 letters><numeric contest id><name cut to 31 chars>".
 *  Pure parsing: no network, no clock. The caller supplies the bytes. */
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { Contest } from '../types';

export interface SdWorkbook {
  title: string;
  county: string;
  precinctsReported: number | null;
  precinctsTotal: number | null;
  /** When the file was generated ("Downloaded at ..."), NOT when the source updated. */
  downloadedAt: string | null;
  contests: Contest[];
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: false, removeNSPrefix: true });

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Candidate names arrive as "Mike  Rounds " -- collapse runs of whitespace and trim. */
export function normalizeName(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function textOf(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  const n = node as { '#text'?: string; t?: unknown; r?: unknown };
  if (n.t !== undefined) return textOf(n.t);
  if (n.r !== undefined) return asArray(n.r).map((r) => textOf((r as { t?: unknown }).t)).join('');
  return n['#text'] ?? '';
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

type Cell = { '@_r': string; '@_t'?: string; v?: string };

function readSheet(xml: string, shared: string[]): string[][] {
  const doc = parser.parse(xml);
  const rows = asArray(doc.worksheet?.sheetData?.row) as Array<{ '@_r': string; c?: Cell | Cell[] }>;
  return rows.map((row) => {
    const out: string[] = [];
    for (const c of asArray(row.c)) {
      const v = c.v ?? '';
      out[colIndex(c['@_r'])] = c['@_t'] === 's' ? (shared[Number(v)] ?? '') : v;
    }
    return out;
  });
}

export function parseSdWorkbook(bytes: Uint8Array): SdWorkbook {
  const files = unzipSync(bytes);
  const get = (name: string): string => {
    const f = files[name];
    if (!f) throw new Error(`sd-xlsx: missing ${name}`);
    return strFromU8(f);
  };
  const shared = asArray(parser.parse(get('xl/sharedStrings.xml')).sst?.si).map((si) => textOf(si));
  const wb = parser.parse(get('xl/workbook.xml'));
  const rels = asArray(parser.parse(get('xl/_rels/workbook.xml.rels')).Relationships?.Relationship) as Array<{ '@_Id': string; '@_Target': string }>;
  const target = new Map(rels.map((r) => [r['@_Id'], r['@_Target'].replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/')]));
  const sheets = asArray(wb.workbook?.sheets?.sheet) as Array<{ '@_name': string; '@_id': string }>;

  const result: SdWorkbook = { title: '', county: '', precinctsReported: null, precinctsTotal: null, downloadedAt: null, contests: [] };
  for (const sheet of sheets) {
    const name = sheet['@_name'];
    const m = /^([A-Z]{3})(\d+)/.exec(name);
    if (!m) throw new Error(`sd-xlsx: sheet "${name}" has no <party><contest id> prefix`);
    const path = target.get(sheet['@_id']);
    if (!path) throw new Error(`sd-xlsx: no relationship for sheet "${name}"`);
    const rows = readSheet(get(path), shared);

    // Rows are located by content, not position, so a blank spacer row (row 6) never matters.
    const nonEmpty = rows.filter((r) => r && r.some((v) => v !== undefined && v !== ''));

    const prec = nonEmpty.find((r) => /^Precincts\s+\d+\s+of\s+\d+/.test(r[0] ?? ''));
    if (prec) {
      const pm = /^Precincts\s+(\d+)\s+of\s+(\d+)/.exec(prec[0])!;
      result.precinctsReported = Number(pm[1]);
      result.precinctsTotal = Number(pm[2]);
    }
    result.title ||= nonEmpty[0]?.[0] ?? '';
    result.county ||= nonEmpty.find((r) => /County$/.test(r[0] ?? ''))?.[0] ?? '';
    const dl = nonEmpty.find((r) => /^Downloaded at /.test(r[0] ?? ''));
    result.downloadedAt ||= dl ? dl[0].replace(/^Downloaded at /, '') : null;

    const header = nonEmpty.find((r) => r[1] === 'Precinct');
    if (!header) throw new Error(`sd-xlsx: sheet "${name}" has no header row`);
    const totals = nonEmpty.find((r) => r[1] === 'TOTALS');
    if (!totals) throw new Error(`sd-xlsx: sheet "${name}" has no TOTALS row`);

    const choices = [];
    for (let c = 2; c < header.length; c++) {
      const label = normalizeName(header[c] ?? '');
      if (!label) continue;
      const raw = (totals[c] ?? '').toString().trim();
      if (!/^\d+$/.test(raw)) throw new Error(`sd-xlsx: sheet "${name}" TOTALS for "${label}" is not an integer: "${raw}"`);
      choices.push({ name: label, votes: Number(raw) });
    }
    result.contests.push({
      sourceContestId: m[2],
      name: normalizeName((header[0] ?? '').replace(/\n/g, ' - ')),
      party: m[1] === 'NON' ? null : m[1],
      choices,
    });
  }
  return result;
}
