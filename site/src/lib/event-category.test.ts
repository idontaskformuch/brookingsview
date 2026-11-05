import { describe, expect, it } from 'vitest';
import { categoryOfEvent } from './event-category';

describe('categoryOfEvent', () => {
  it.each([
    ['SDSU Concert Choir Fall Concert', 'music'], ['Library Commission Meeting', 'civic'], ['Toddler Storytime', 'family'],
    ['Farmers Market', 'food'], ['Open Mic Night', 'nightlife'], ['Pottery workshop', 'arts'], ['Jackrabbits vs Bison', 'sports'],
  ])('%s -> %s', (title, cat) => expect(categoryOfEvent(title)).toBe(cat));
  it('no match is null, never a guess', () => {
    expect(categoryOfEvent('Mrs. Doubtfire Outdoor Screening')).toBe('arts');
    expect(categoryOfEvent('Shop for a Cause Fundraiser')).toBeNull();
    expect(categoryOfEvent('Veterans Day')).toBeNull();
  });
  it('uses the source category label when it has one', () => {
    expect(categoryOfEvent('Evening at the hall', 'Music')).toBe('music');
  });
});
