import { describe, expect, it } from 'vitest';
import {
  consentNote, motionLabel, outcomeLabel, partitionDecisions, splitOnAgenda, voteTallyText,
  type MeetingDecision,
} from './meeting-decisions';

function decision(overrides: Partial<MeetingDecision>): MeetingDecision {
  return {
    id: 1, event_item_id: 100759, agenda_number: '10.A.', title: 'Second Reading',
    matter_id: 9319, matter_file: 'ORD 26-025', matter_type: 'Ordinance',
    action_text: null, outcome: 'pending', is_consent_item: false,
    consent_block_event_item_id: null, votes: null, source_url: null,
    ...overrides,
  };
}

describe('partitionDecisions', () => {
  it('splits pending items into onAgenda and everything else into decided', () => {
    const pending = decision({ outcome: 'pending' });
    const approved = decision({ event_item_id: 2, outcome: 'approved' });
    const { onAgenda, decided } = partitionDecisions([pending, approved]);
    expect(onAgenda).toEqual([pending]);
    expect(decided).toEqual([approved]);
  });
});

describe('splitOnAgenda', () => {
  const tz = 'America/Chicago';

  it('keeps a pending item under "On the agenda" when the meeting is recent', () => {
    const pending = decision({ outcome: 'pending' });
    const meetingDate = new Date('2026-09-01T18:00:00Z'); // 30 days before `now`
    const now = new Date('2026-10-01T12:00:00Z');
    expect(splitOnAgenda([pending], meetingDate, now, tz)).toEqual({
      open: [pending], noRecordedOutcome: [],
    });
  });

  it('moves a pending item to "No recorded outcome" once the meeting is 61+ days old', () => {
    const pending = decision({ outcome: 'pending' });
    const meetingDate = new Date('2026-08-01T18:00:00Z'); // 61 days before `now`
    const now = new Date('2026-10-01T12:00:00Z');
    expect(splitOnAgenda([pending], meetingDate, now, tz)).toEqual({
      open: [], noRecordedOutcome: [pending],
    });
  });

  it('stays "On the agenda" at exactly the 60-day boundary', () => {
    const pending = decision({ outcome: 'pending' });
    const meetingDate = new Date('2026-08-02T18:00:00Z'); // 60 days before `now`
    const now = new Date('2026-10-01T12:00:00Z');
    expect(splitOnAgenda([pending], meetingDate, now, tz).open).toEqual([pending]);
  });
});

describe('voteTallyText', () => {
  it('returns null when there is no roll call', () => {
    expect(voteTallyText(null)).toBeNull();
    expect(voteTallyText([])).toBeNull();
  });

  it('tallies a unanimous vote', () => {
    const votes = [
      { person: 'A', value: 'Yes' }, { person: 'B', value: 'Yes' }, { person: 'C', value: 'Yes' },
    ];
    expect(voteTallyText(votes)).toBe('3-0');
  });

  it('tallies a split vote with absent/abstain noted', () => {
    const votes = [
      { person: 'A', value: 'Yes' }, { person: 'B', value: 'No' },
      { person: 'C', value: 'Absent' }, { person: 'D', value: 'Abstain' },
    ];
    expect(voteTallyText(votes)).toBe('1-1 (1 absent, 1 abstaining)');
  });

  it('matches vote values case-insensitively', () => {
    const votes = [{ person: 'A', value: 'yes' }, { person: 'B', value: 'no' }];
    expect(voteTallyText(votes)).toBe('1-1');
  });

  it('is the verified real cityofbrookings 2026-09-08 unanimous consent vote (7-0)', () => {
    const votes = ['Holly Tilton Byrne', 'Bonny Specker', 'Lisa Hager', 'Wayne Avery',
      'Brianna Doran', 'Oepke Niemeyer', 'Nick Wendell'].map((person) => ({ person, value: 'Yes' }));
    expect(voteTallyText(votes)).toBe('7-0');
  });
});

describe('motionLabel', () => {
  it('prefers the real motion narrative over the bare title', () => {
    const d = decision({ action_text: 'A motion was made by X, seconded by Y, that it be approved.' });
    expect(motionLabel(d)).toBe('A motion was made by X, seconded by Y, that it be approved.');
  });

  it('falls back to the title when there is no motion narrative', () => {
    const d = decision({ action_text: null, title: 'Second Reading' });
    expect(motionLabel(d)).toBe('Second Reading');
  });
});

describe('consentNote / outcomeLabel', () => {
  it('labels a consent item without claiming it had its own separate vote', () => {
    expect(consentNote(decision({ is_consent_item: true }))).toBe(
      'Approved as part of the Consent Agenda',
    );
    expect(consentNote(decision({ is_consent_item: false }))).toBeNull();
  });

  it('never shows an outcome label for a pending item', () => {
    expect(outcomeLabel(decision({ outcome: 'pending' }))).toBeNull();
  });

  it('shows the real human label for a decided outcome', () => {
    expect(outcomeLabel(decision({ outcome: 'denied' }))).toBe('Denied');
    expect(outcomeLabel(decision({ outcome: 'received_and_filed' }))).toBe('Received and filed');
  });
});
