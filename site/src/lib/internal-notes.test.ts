// Broomfield AdSense plan F6 (2026-11-11): a working note from data/facilities reached a public page. The same checker runs on the
// real dist/ of every town in scripts/verify_no_internal_notes.mjs (deploy workflows + battery); this file pins its rules.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findInternalNotes } from '../../../scripts/internal_notes.mjs';

const page = (body: string, description = 'A page.') =>
  `<html><head><title>T</title><meta name="description" content="${description}"></head><body><main>${body}</main></body></html>`;

describe('findInternalNotes', () => {
  it('flags the live recycling-center page of 2026-11-11 (NEEDS-HUMAN-REVIEW.md in the lede)', () => {
    const html = readFileSync(join(__dirname, '../../../tests/fixtures/qa_internal_note_recycling_2026-11-11.html'), 'utf8');
    const names = findInternalNotes(html).map((f) => f.name);
    expect(names).toContain('NEEDS-HUMAN-REVIEW');
    expect(names).toContain('.md file name');
  });

  it('flags TODO, FIXME and PENDING in capitals, and a note in the meta description', () => {
    expect(findInternalNotes(page('<p>TODO: hours</p>'))).toHaveLength(1);
    expect(findInternalNotes(page('<p>FIXME</p>'))).toHaveLength(1);
    expect(findInternalNotes(page('<p>Status PENDING</p>'))).toHaveLength(1);
    expect(findInternalNotes(page('<p>ok</p>', 'see README.md'))[0].where).toBe('description');
  });

  it('flags code paths and re-verify notes (Moreno farm-house-collective, Broomfield station 68, 2026-11-11 texts)', () => {
    const farm = "A private event venue in central Riverside (not inside Moreno Valley's own town limits -- see lib/town-boundary.ts) hosting live music; configs/moreno_valley_ca.json's own events.sources already includes it.";
    expect(findInternalNotes(page(`<p>${farm}</p>`)).map((f) => f.name)).toEqual(['code file name']);
    const st68 = "The district's own listing labels this a temporary structure as of 2026 -- re-verify this address in ~6 months.";
    expect(findInternalNotes(page(`<p>${st68}</p>`)).map((f) => f.name)).toEqual(['re-verify']);
  });

  it('passes ordinary text, scripts, styles and comments', () => {
    const html = page('<p>The outcome is pending. We still have to do it.</p><script>// TODO later</script><style>.x{}</style><!-- FIXME -->');
    expect(findInternalNotes(html)).toEqual([]);
  });
});
