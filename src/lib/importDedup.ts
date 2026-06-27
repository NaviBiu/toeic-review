export type ExistingMatch = {
  status: 'active' | 'mastered' | 'deleted';
  dateAdded: string;
  meaning: string;
  example: string;
  notes: string | null;
} | null;

export type CandidateRecord = {
  dateAdded: string;
  meaning: string;
  example: string;
  notes: string | null;
};

export type DedupDecision =
  | { action: 'skip_duplicate' }
  | { action: 'insert_new' }
  | { action: 'wrong_again'; reviveFromMastered: boolean; textConflict: boolean };

export function decideDedup(candidate: CandidateRecord, existing: ExistingMatch): DedupDecision {
  if (existing === null || existing.status === 'deleted') {
    return { action: 'insert_new' };
  }
  if (existing.dateAdded === candidate.dateAdded) {
    return { action: 'skip_duplicate' };
  }
  const textConflict =
    existing.meaning !== candidate.meaning ||
    existing.example !== candidate.example ||
    existing.notes !== candidate.notes;
  return {
    action: 'wrong_again',
    reviveFromMastered: existing.status === 'mastered',
    textConflict,
  };
}
