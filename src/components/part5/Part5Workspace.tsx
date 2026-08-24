'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CategoryNode, CreateSessionInput, QuestionListItem, SessionQuestion } from '@/lib/questionReview/types';
import QuestionEditorModal from './QuestionEditorModal';
import QuestionLibrary from './QuestionLibrary';
import TrainingSetup from './TrainingSetup';

type WorkspaceTab = 'library' | 'categories' | 'training';
type Session = { id: number; actualCount: number; questions: SessionQuestion[] };
type CategoryLoadState = {
  categories: CategoryNode[] | null;
  initialLoading: boolean;
  error: string;
};

const tabs: { id: WorkspaceTab; label: string }[] = [
  { id: 'library', label: '错题库' },
  { id: 'categories', label: '分类管理' },
  { id: 'training', label: '训练设置' },
];

export function beginCategoryRefresh(categories: CategoryNode[] | null): CategoryLoadState {
  return { categories, initialLoading: categories === null, error: '' };
}

function aggregateCategories(categories: CategoryNode[]) {
  return categories.reduce((stats, category) => ({
    total: stats.total + category.stats.total,
    attempted: stats.attempted + category.stats.attempted,
    unattempted: stats.unattempted + category.stats.unattempted,
    latestCorrect: stats.latestCorrect + category.stats.latestCorrect,
  }), { total: 0, attempted: 0, unattempted: 0, latestCorrect: 0 });
}

function formatAccuracy(latestCorrect: number, attempted: number) {
  return attempted === 0 ? '—' : `${Math.round((latestCorrect / attempted) * 100)}%`;
}

function CategoryRows({ categories }: { categories: CategoryNode[] }) {
  return (
    <div className="divide-y divide-stone-200 border border-stone-200 bg-white">
      {categories.map((category) => (
        <div key={category.id}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-sm">
            <span className="font-medium text-stone-900">{category.name}</span>
            <span className="text-stone-500">{category.stats.total} 题</span>
            <span className="font-mono text-xs text-stone-500">{formatAccuracy(category.stats.latestCorrect, category.stats.attempted)}</span>
          </div>
          {category.children.map((child) => (
            <div key={child.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-t border-stone-100 bg-stone-50 px-4 py-2.5 text-sm">
              <span className="pl-4 text-stone-700">{child.name}</span>
              <span className="text-stone-500">{child.stats.total} 题</span>
              <span className="font-mono text-xs text-stone-500">{formatAccuracy(child.stats.latestCorrect, child.stats.attempted)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Part5Workspace() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('library');
  const [categoryRefreshVersion, setCategoryRefreshVersion] = useState(0);
  const [questionRefreshVersion, setQuestionRefreshVersion] = useState(0);
  const [editorQuestion, setEditorQuestion] = useState<QuestionListItem | null | undefined>(undefined);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [categoriesState, setCategoriesState] = useState<CategoryLoadState>(() => beginCategoryRefresh(null));
  const [starting, setStarting] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const editorOpen = editorQuestion !== undefined;

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/question-categories?section=reading&part=5', { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? '分类加载失败，请重试');
        return body as CategoryNode[];
      })
      .then((categories) => {
        if (!controller.signal.aborted) setCategoriesState({ categories, initialLoading: false, error: '' });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setCategoriesState((current) => ({
          categories: current.categories,
          initialLoading: false,
          error: error instanceof Error ? error.message : '分类加载失败，请重试',
        }));
      });
    return () => controller.abort();
  }, [categoryRefreshVersion]);

  const categories = categoriesState.categories;
  const summary = useMemo(
    () => categories ? aggregateCategories(categories) : null,
    [categories],
  );

  async function startTraining(input: CreateSessionInput) {
    setStarting(true);
    setSessionError('');
    try {
      const response = await fetch('/api/question-review-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? '训练创建失败，请重试');
      setActiveSession(body as Session);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : '训练创建失败，请重试');
    } finally {
      setStarting(false);
    }
  }

  function refreshCategories() {
    setCategoriesState((current) => beginCategoryRefresh(current.categories));
    setCategoryRefreshVersion((version) => version + 1);
  }

  function openEditor(question: QuestionListItem | null) {
    setEditorQuestion(question);
  }

  function closeEditor() {
    setEditorQuestion(undefined);
  }

  function handleQuestionChanged() {
    setQuestionRefreshVersion((version) => version + 1);
    refreshCategories();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-7 sm:px-6 sm:py-9">
      <header className="border-b border-stone-300 pb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-stone-500">Reading / Part 5</p>
            <h1 className="mt-1 text-xl font-semibold text-stone-900">语法与词汇训练</h1>
          </div>
          {activeSession ? <p className="text-sm text-emerald-700">训练已创建：{activeSession.actualCount} 题</p> : null}
        </div>
        <dl className="mt-5 grid grid-cols-2 divide-x divide-y divide-stone-200 border border-stone-200 bg-white sm:grid-cols-4">
          {[
            ['有效题目', summary?.total],
            ['已作答', summary?.attempted],
            ['未作答', summary?.unattempted],
            ['最新正确率', summary ? formatAccuracy(summary.latestCorrect, summary.attempted) : null],
          ].map(([label, value]) => (
            <div key={String(label)} className="min-w-0 px-4 py-3">
              <dt className="text-xs text-stone-500">{label}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold text-stone-900">{value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="mt-5 border-b border-stone-300" role="tablist" aria-label="Part 5 工作区">
        <div className="flex gap-5 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 border-b-2 px-1 pb-3 text-sm font-medium ${activeTab === tab.id ? 'border-stone-800 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <section className="pt-5" role="tabpanel">
        {categoriesState.initialLoading ? <p className="py-10 text-sm text-stone-500">正在加载 Part 5 分类和统计…</p> : null}
        {!categories && categoriesState.error ? (
          <div className="flex flex-wrap items-center gap-3 border-l-2 border-red-600 bg-red-50 px-3 py-3 text-sm text-red-800">
            <p>{categoriesState.error}</p>
            <button type="button" onClick={refreshCategories} className="rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium text-red-700 hover:bg-red-100">重试</button>
          </div>
        ) : null}
        {categories && categoriesState.error ? <p className="mb-3 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">{categoriesState.error}</p> : null}
        {categories && activeTab === 'library' ? (
          <QuestionLibrary categories={categories} refreshVersion={questionRefreshVersion} onEdit={openEditor} onChanged={handleQuestionChanged} />
        ) : null}
        {categories && activeTab === 'categories' ? (
          <div>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-stone-900">分类管理</h2>
              <button type="button" onClick={refreshCategories} className="text-sm font-medium text-stone-600 hover:text-stone-900">刷新</button>
            </div>
            <CategoryRows categories={categories} />
          </div>
        ) : null}
        {categories && activeTab === 'training' ? (
          <div>
            <TrainingSetup categories={categories} onStart={startTraining} starting={starting} />
            {sessionError ? <p className="mt-3 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">{sessionError}</p> : null}
          </div>
        ) : null}
      </section>
      {categories && editorOpen ? <QuestionEditorModal questionId={editorQuestion?.id ?? null} initialQuestion={editorQuestion ?? null} categories={categories} open onClose={closeEditor} onSaved={handleQuestionChanged} /> : null}
    </div>
  );
}
