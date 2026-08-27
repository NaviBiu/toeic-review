import type { TrainingMode } from './types';

export type SelectionCandidate = {
  id: number;
  latestCorrect: boolean | null;
};

function weightFor(candidate: SelectionCandidate, mode: TrainingMode): number {
  if (mode === 'random') return 1;
  if (candidate.latestCorrect === null) return 4;
  return candidate.latestCorrect ? 1 : 3;
}

export function selectQuestionIds(
  candidates: SelectionCandidate[],
  count: number,
  mode: TrainingMode,
  random: () => number = Math.random,
): number[] {
  const remaining = [...candidates];
  const selected: number[] = [];
  const targetCount = Math.min(Math.max(0, count), remaining.length);

  while (selected.length < targetCount) {
    const totalWeight = remaining.reduce((sum, candidate) => sum + weightFor(candidate, mode), 0);
    let ticket = random() * totalWeight;
    let selectedIndex = remaining.length - 1;

    for (let index = 0; index < remaining.length; index += 1) {
      ticket -= weightFor(remaining[index], mode);
      if (ticket < 0) {
        selectedIndex = index;
        break;
      }
    }

    selected.push(remaining[selectedIndex].id);
    remaining.splice(selectedIndex, 1);
  }

  return selected;
}
