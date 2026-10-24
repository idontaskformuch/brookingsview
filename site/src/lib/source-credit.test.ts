import { describe, expect, it } from 'vitest';
import { sourceCreditName } from './source-credit';

describe('sourceCreditName', () => {
  it('credits the city for its own calendar links, with or without www', () => {
    expect(sourceCreditName('https://www.broomfield.org/calendar.aspx?EID=11038')).toBe('City and County of Broomfield');
    expect(sourceCreditName('https://broomfield.org/calendar.aspx?EID=1')).toBe('City and County of Broomfield');
  });
  it('credits the library calendar separately', () => {
    expect(sourceCreditName('https://compass.broomfield.org/events/x')).toBe('Broomfield Library (Compass)');
  });
  it('credits Glasgow Life for its event pages', () => {
    expect(sourceCreditName('https://www.glasgowlife.org.uk/event/1/sunday-colouring-club')).toBe('Glasgow Life');
  });
  it('returns null for unknown hosts and bad input', () => {
    expect(sourceCreditName('https://example.com/x')).toBeNull();
    expect(sourceCreditName('not a url')).toBeNull();
    expect(sourceCreditName(null)).toBeNull();
  });
});
