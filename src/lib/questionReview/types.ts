export type QuestionStatus = 'learning' | 'mastered' | 'inactive' | 'deleted';
export type TrainingMode = 'weak_first' | 'random';
export type QuestionOption = 'A' | 'B' | 'C' | 'D';

export type CategoryStats = {
  total: number;
  attempted: number;
  unattempted: number;
  latestCorrect: number;
  accuracy: number | null;
};

export type QuestionCategory = {
  id: number;
  section: 'reading';
  part: 5 | 6 | 7;
  parentId: number | null;
  name: string;
  isDefault: boolean;
  status: 'active' | 'inactive';
  sortOrder: number;
};

export type CategoryNode = QuestionCategory & {
  stats: CategoryStats;
  children: CategoryNode[];
};

export type QuestionStats = {
  correctCount: number;
  wrongCount: number;
  latestCorrect: boolean | null;
  latestDurationMs: number | null;
};

export type ReviewQuestion = {
  id: number;
  section: 'reading';
  part: 5 | 6 | 7;
  questionFormat: 'single_choice';
  stem: string;
  options: Record<QuestionOption, string>;
  correctOption: QuestionOption;
  analysis: string;
  notes: string | null;
  source: string | null;
  categoryId: number;
  status: QuestionStatus;
};

export type QuestionListItem = ReviewQuestion & {
  categoryPath: [string, string];
  stats: QuestionStats;
};

export type CreateSessionInput = {
  mode: TrainingMode;
  categoryScopeId: number | null;
  includeMastered: boolean;
  plannedCount: number;
};

export type SessionQuestion = {
  id: number;
  position: number;
  stem: string;
  options: Record<QuestionOption, string>;
  source: string | null;
  categoryPath: [string, string];
  stats: QuestionStats;
};

export type AttemptResult = {
  attemptId: number;
  isCorrect: boolean;
  correctOption: QuestionOption;
  analysis: string;
  notes: string | null;
  durationMs: number | null;
  durationExcluded: boolean;
  stats: QuestionStats;
};
