'use client';

import { useState } from 'react';
import type { CategoryNode, CreateSessionInput, TrainingMode } from '@/lib/questionReview/types';

type CategoryChoice = {
  id: number;
  label: string;
  total: number;
};

export function normalizeTrainingCount(value: number, available: number) {
  if (available <= 0) return 0;
  return Math.min(available, Math.max(1, Math.floor(value) || 1));
}

export function buildTrainingSummary(planned: number, available: number) {
  return `计划 ${planned} 题，可用 ${available} 题，本次将练习 ${normalizeTrainingCount(planned, available)} 题`;
}

export function getTrainingAvailability(
  categories: CategoryNode[],
  categoryScopeId: number | null,
  includeMastered: boolean,
  plannedCount: number,
) {
  const scopedStats = categoryScopeId === null
    ? categories.reduce((stats, category) => ({
      learningCount: stats.learningCount + category.stats.learningCount,
      masteredCount: stats.masteredCount + category.stats.masteredCount,
    }), { learningCount: 0, masteredCount: 0 })
    : categories.flatMap((category) => [category, ...category.children])
      .find((category) => category.id === categoryScopeId)?.stats;
  const available = scopedStats
    ? scopedStats.learningCount + (includeMastered ? scopedStats.masteredCount : 0)
    : 0;
  const effectiveCount = normalizeTrainingCount(plannedCount, available);
  return { available, effectiveCount, disabled: effectiveCount === 0 };
}

function categoryChoices(categories: CategoryNode[]): CategoryChoice[] {
  return categories.flatMap((category) => [
    { id: category.id, label: category.name, total: category.stats.total },
    ...category.children.map((child) => ({
      id: child.id,
      label: `${category.name} / ${child.name}`,
      total: child.stats.total,
    })),
  ]);
}

export default function TrainingSetup({
  categories,
  onStart,
  starting,
}: {
  categories: CategoryNode[];
  onStart: (input: CreateSessionInput) => void | Promise<void>;
  starting: boolean;
}) {
  const choices = categoryChoices(categories);
  const [mode, setMode] = useState<TrainingMode>('weak_first');
  const [categoryScopeId, setCategoryScopeId] = useState<number | null>(null);
  const [plannedCount, setPlannedCount] = useState(20);
  const [includeMastered, setIncludeMastered] = useState(false);

  const availability = getTrainingAvailability(categories, categoryScopeId, includeMastered, plannedCount);

  function handleCountChange(value: string) {
    const next = Number(value);
    setPlannedCount(Number.isFinite(next) ? Math.min(100, Math.max(0, Math.floor(next))) : 0);
  }

  function handleStart() {
    if (availability.disabled || starting) return;
    void onStart({ mode, categoryScopeId, includeMastered, plannedCount: availability.effectiveCount });
  }

  return (
    <section aria-labelledby="training-setup-title" className="border border-stone-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-200 pb-3">
        <h2 id="training-setup-title" className="text-base font-semibold text-stone-900">训练设置</h2>
        <p className="text-sm text-stone-500">{buildTrainingSummary(plannedCount, availability.available)}</p>
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <fieldset>
          <legend className="text-sm font-medium text-stone-700">出题顺序</legend>
          <div className="mt-2 inline-flex overflow-hidden rounded-md border border-stone-300" role="group" aria-label="出题顺序">
            {([
              ['weak_first', '薄弱优先'],
              ['random', '随机'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={`min-w-24 border-r border-stone-300 px-3 py-2 text-sm font-medium last:border-r-0 ${mode === value ? 'bg-stone-800 text-white' : 'bg-white text-stone-600 hover:bg-stone-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block text-sm font-medium text-stone-700">
          分类范围
          <select
            value={categoryScopeId ?? ''}
            onChange={(event) => setCategoryScopeId(event.target.value ? Number(event.target.value) : null)}
            className="mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800"
          >
            <option value="">全部分类</option>
            {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label} ({choice.total})</option>)}
          </select>
        </label>

        <div className="flex flex-wrap items-end gap-4">
          <label className="block text-sm font-medium text-stone-700">
            题数
            <input
              type="number"
              min="1"
              max="100"
              inputMode="numeric"
              value={plannedCount}
              onChange={(event) => handleCountChange(event.target.value)}
              className="mt-2 block w-24 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800"
            />
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={includeMastered}
              onChange={(event) => setIncludeMastered(event.target.checked)}
              className="h-4 w-4 rounded border-stone-300 text-stone-800 focus:ring-stone-500"
            />
            包含已掌握
          </label>
          <button
            type="button"
            onClick={handleStart}
            disabled={availability.disabled || starting}
            className="rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {starting ? '正在创建…' : '开始训练'}
          </button>
        </div>
      </div>
    </section>
  );
}
