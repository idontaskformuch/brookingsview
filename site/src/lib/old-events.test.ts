import { describe, it, expect } from 'vitest';
import { isPrunedEvent, PRUNE_EVENT_AFTER_DAYS } from './old-events';

const NOW = new Date('2026-10-28T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();

describe('isPrunedEvent', () => {
  it('prunes an event that ended more than the limit ago', () => {
    expect(isPrunedEvent({ source_type: 'event', occurs_at: daysAgo(PRUNE_EVENT_AFTER_DAYS + 1) }, NOW)).toBe(true);
  });
  it('keeps a recent past event', () => {
    expect(isPrunedEvent({ source_type: 'event', occurs_at: daysAgo(PRUNE_EVENT_AFTER_DAYS - 1) }, NOW)).toBe(false);
  });
  it('uses the end when there is one: a long exhibition that started long ago but ends soon stays', () => {
    expect(isPrunedEvent({ source_type: 'event', occurs_at: daysAgo(200), ends_at: daysAgo(-5) }, NOW)).toBe(false);
    expect(isPrunedEvent({ source_type: 'event', occurs_at: daysAgo(200), ends_at: daysAgo(70) }, NOW)).toBe(true);
  });
  it('never prunes a series, an undated event or another type', () => {
    expect(isPrunedEvent({ source_type: 'event', occurs_at: daysAgo(400), is_recurring_series: true }, NOW)).toBe(false);
    expect(isPrunedEvent({ source_type: 'event', occurs_at: null }, NOW)).toBe(false);
    expect(isPrunedEvent({ source_type: 'meeting', occurs_at: daysAgo(400) }, NOW)).toBe(false);
  });
});
