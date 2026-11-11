import { describe, expect, it } from 'vitest';
import { llmsAboutLines } from './llms-about';
import { aiDisclosure } from './ai-disclosure';

describe('llmsAboutLines', () => {
  const lines = llmsAboutLines({ siteName: 'Broomfield View', place: 'Broomfield, CO', sourceBlurb: 'Broomfield View gathers public information from the City and County of Broomfield.' });
  it('says what the site is and is not, in the first line', () => {
    expect(lines[0]).toMatch(/independent local information site/);
    expect(lines[0]).toMatch(/not a government agency/);
  });
  it('says what is collected and how content is produced', () => {
    expect(lines[1]).toContain('City and County of Broomfield');
    // B6 (2026-11-11): place and project descriptions were written with an AI model; the old "not shown" claim was false.
    expect(lines[1]).toContain(aiDisclosure());
    expect(llmsAboutLines({ siteName: 'G', place: 'Glasgow', sourceBlurb: 'x.', projects: false })[1]).not.toContain('projects');
    expect(lines[1]).not.toMatch(/AI model is not shown/);
    expect(lines[1]).not.toMatch(/drafted|written by an AI model working/);
    expect(lines[1]).toMatch(/links back to its source/);
  });
  it('names no person or employer', () => {
    expect(lines.join(' ')).not.toMatch(/Sweden|spare time|day job|bIb/);
  });
});
