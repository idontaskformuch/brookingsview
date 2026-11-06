import { describe, expect, it } from 'vitest';
import { llmsAboutLines } from './llms-about';

describe('llmsAboutLines', () => {
  const lines = llmsAboutLines({ siteName: 'Broomfield View', place: 'Broomfield, CO', sourceBlurb: 'Broomfield View gathers public information from the City and County of Broomfield.' });
  it('says what the site is and is not, in the first line', () => {
    expect(lines[0]).toMatch(/independent local information site/);
    expect(lines[0]).toMatch(/not a government agency/);
  });
  it('says what is collected and how content is produced', () => {
    expect(lines[1]).toContain('City and County of Broomfield');
    expect(lines[1]).toMatch(/AI model is not shown/);
    expect(lines[1]).not.toMatch(/drafted|written by an AI model working/);
    expect(lines[1]).toMatch(/links back to its source/);
  });
  it('names no person or employer', () => {
    expect(lines.join(' ')).not.toMatch(/Sweden|spare time|day job|bIb/);
  });
});
