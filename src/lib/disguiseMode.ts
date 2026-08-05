export const WORK_MODE_STORAGE_KEY = 'toeic-work-mode';
export const WORK_SKIN_STORAGE_KEY = 'toeic-work-skin';
export const WORK_MODE_CHANGE_EVENT = 'toeic-work-mode-change';

export type WorkSkin = {
  id: 'requirements' | 'project-board' | 'meeting-notes' | 'release-summary' | 'control-checklist';
  title: string;
  documentId: string;
  reviewTitle: string;
};

export const workSkins: WorkSkin[] = [
  { id: 'requirements', title: 'Requirements Review', documentId: 'RFC-L-800 / draft', reviewTitle: 'Daily Review Requirements' },
  { id: 'project-board', title: 'Project Workspace', documentId: 'PRJ-DELTA / active', reviewTitle: 'Project Readiness Board' },
  { id: 'meeting-notes', title: 'Meeting Notes', documentId: 'MIN-0720 / notes', reviewTitle: 'Working Session Notes' },
  { id: 'release-summary', title: 'Release Summary', documentId: 'REL-12 / gate', reviewTitle: 'Release Gate Summary' },
  { id: 'control-checklist', title: 'Control Checklist', documentId: 'CTL-200 / current', reviewTitle: 'Control Verification Log' },
];

export function getWorkSkin(id: string | null) {
  return workSkins.find((skin) => skin.id === id) ?? workSkins[0];
}

export function getNextWorkSkin(currentId: string, random = Math.random) {
  const candidates = workSkins.filter((skin) => skin.id !== currentId);
  return candidates[Math.floor(random() * candidates.length)] ?? workSkins[0];
}

export const workReviewCopy = {
  title: 'Daily Review Requirements',
  pending: (count: number) => `${count} items pending`,
  allWorkstreams: 'All workstreams',
  loading: 'Loading review items...',
  empty: 'No review items are pending today.',
  loadError: 'Unable to load the review queue. Please try again.',
  saveError: 'Unable to record this decision. Please try again.',
  confirmed: 'Confirmed',
  followUp: 'Needs follow-up',
  yourDecision: 'Decision',
  revert: 'Revert decision',
  continue: 'Continue',
  mastered: 'Mark as mastered',
  delete: 'Remove from review',
  deleted: 'Item removed.',
  restore: 'Restore',
  termAudio: 'Read item aloud',
  exampleAudio: 'Read context aloud',
};

export const studyNav = [
  { href: '/review', label: '今日复盘' },
  { href: '/knowledge-points', label: '错题库' },
  { href: '/knowledge-points/import', label: '导入笔记' },
  { href: '/mastered', label: '已掌握' },
  { href: '/mock-exams', label: '模考记录' },
  { href: '/stats', label: '统计' },
];

export const workModeNav = [
  { href: '/review', label: 'Review Notes' },
  { href: '/knowledge-points', label: 'Issue Library' },
  { href: '/knowledge-points/import', label: 'Import Brief' },
  { href: '/mastered', label: 'Resolved Items' },
  { href: '/mock-exams', label: 'Progress Metrics' },
  { href: '/stats', label: 'Reporting' },
];

const sectionTitles: Record<string, string> = {
  '/review': 'Daily Review Requirements',
  '/knowledge-points': 'Issue Library Requirements',
  '/knowledge-points/import': 'Import Brief Requirements',
  '/mastered': 'Resolved Items Requirements',
  '/mock-exams': 'Progress Metrics Requirements',
  '/stats': 'Reporting Requirements',
};

export function getDisguiseTitle(pathname: string) {
  return sectionTitles[pathname] ?? 'Requirements Review Brief';
}
