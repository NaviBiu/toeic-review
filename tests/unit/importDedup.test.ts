import { describe, it, expect } from 'vitest';
import { decideDedup } from '../../src/lib/importDedup';

const candidate = { dateAdded: '2026-06-26', meaning: 'm', example: 'e', notes: null };

describe('decideDedup', () => {
  it('inserts as new when there is no existing match', () => {
    expect(decideDedup(candidate, null)).toEqual({ action: 'insert_new' });
  });

  it('inserts as new when the only match is deleted', () => {
    const existing = { status: 'deleted' as const, dateAdded: '2026-06-20', meaning: 'm', example: 'e', notes: null };
    expect(decideDedup(candidate, existing)).toEqual({ action: 'insert_new' });
  });

  it('skips as a duplicate upload when date_added matches an active record', () => {
    const existing = { status: 'active' as const, dateAdded: '2026-06-26', meaning: 'm', example: 'e', notes: null };
    expect(decideDedup(candidate, existing)).toEqual({ action: 'skip_duplicate' });
  });

  it('treats a different date_added on an active record as wrong-again, even with identical text', () => {
    const existing = { status: 'active' as const, dateAdded: '2026-06-20', meaning: 'm', example: 'e', notes: null };
    expect(decideDedup(candidate, existing)).toEqual({ action: 'wrong_again', reviveFromMastered: false, textConflict: false });
  });

  it('flags a text conflict when descriptive fields differ, independent of the wrong-again decision', () => {
    const existing = { status: 'active' as const, dateAdded: '2026-06-20', meaning: 'old', example: 'e', notes: null };
    expect(decideDedup(candidate, existing)).toEqual({ action: 'wrong_again', reviveFromMastered: false, textConflict: true });
  });

  it('signals revival when the matched record is mastered', () => {
    const existing = { status: 'mastered' as const, dateAdded: '2026-06-20', meaning: 'm', example: 'e', notes: null };
    expect(decideDedup(candidate, existing)).toEqual({ action: 'wrong_again', reviveFromMastered: true, textConflict: false });
  });
});
