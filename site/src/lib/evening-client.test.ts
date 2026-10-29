import { describe, it, expect } from 'vitest';
import { countVisibleThings } from './evening-client';

// Minimal stand-in for the DOM: the vitest environment is node, and countVisibleThings only uses querySelectorAll/closest/hidden.
type El = { hidden?: boolean; closest: (s: string) => unknown; querySelectorAll: (s: string) => El[] };
const entry = (hidden = false): El => ({ hidden, closest: () => null, querySelectorAll: () => [] });
const day = (entries: El[]): El => ({ closest: () => null, querySelectorAll: () => entries });
const doc = (days: El[]) => ({ querySelectorAll: () => days }) as unknown as Document;

describe('countVisibleThings', () => {
  // Born from the live /tonight (2026-10-29): the page said "24 things on tonight" with 12 tonight and 12 tomorrow night.
  const tonightAndTomorrow = doc([day([entry(), entry(), entry()]), day([entry(), entry()])]);
  it('/tonight counts only the first visible day', () => expect(countVisibleThings(tonightAndTomorrow, true)).toBe(3));
  it('/this-weekend counts every visible day', () => expect(countVisibleThings(tonightAndTomorrow)).toBe(5));
  it('ended (hidden) rows are left out', () => expect(countVisibleThings(doc([day([entry(true), entry()])]), true)).toBe(1));
});
