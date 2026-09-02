import type { SrsState } from '@/lib/srs';

export type ReadingNoteStatus = 'active' | 'mastered' | 'deleted';
export type ReadingDecision = 'known' | 'unknown';
export type ReadingSrsSnapshot = SrsState & { lastReviewedDate: string | null };

export type ReadingNoteCategory = {
  id: number;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  status: 'active' | 'deleted';
  noteCount: number;
};

export type ReadingNote = {
  id: number;
  categoryId: number;
  categoryName: string;
  contentHtml: string;
  contentText: string;
  notes: string | null;
  noteDate: string;
  status: ReadingNoteStatus;
  correctStreak: number;
  correctCount: number;
  wrongCount: number;
  nextReviewDate: string | null;
  lastReviewedDate: string | null;
};

export type ReadingReviewAttempt = {
  id: number;
  requestId: string;
  noteId: number;
  decision: ReadingDecision;
  reviewDate: string;
  beforeState: ReadingSrsSnapshot;
  afterState: ReadingSrsSnapshot;
};

export type ReadingImportCandidate = {
  sourceIndex: number;
  categoryName: string;
  contentHtml: string;
  contentText: string;
  notes: string | null;
  noteDate: string;
  confidence: 'high' | 'low';
  issue: string | null;
};

export type ReadingImportPreview = {
  token: string;
  recognizedCount: number;
  duplicateCount: number;
  unrecognizedCount: number;
  existingCategories: string[];
  proposedCategories: string[];
  candidates: ReadingImportCandidate[];
  exceptions: ReadingImportCandidate[];
  aiFallbackAvailable: boolean;
};

export type ReadingQueuePage = {
  items: ReadingNote[];
  totalPending: number;
  hasMore: boolean;
};
