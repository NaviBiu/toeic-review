'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CategoryNode, QuestionListItem, QuestionStatus } from '@/lib/questionReview/types';

const PAGE_SIZE = 20;
const statuses: QuestionStatus[] = ['learning', 'mastered', 'inactive', 'deleted'];

type Sort = 'updated_desc' | 'created_desc' | 'accuracy_asc' | 'unattempted_first';

type LibraryFilters = {
  search: string;
  categoryId: number | null;
  status: QuestionStatus | '';
  sort: Sort;
  page: number;
};

type CategoryChoice = {
  id: number;
  label: string;
};

const statusLabels: Record<QuestionStatus, string> = {
  learning: '学习中',
  mastered: '已掌握',
  inactive: '已停用',
  deleted: '已删除',
};

const sortLabels: Record<Sort, string> = {
  updated_desc: '最近更新',
  created_desc: '最近添加',
  accuracy_asc: '正确率从低到高',
  unattempted_first: '未作答优先',
};

export function buildQuestionListQuery(filters: LibraryFilters) {
  const params = new URLSearchParams();
  const search = filters.search.trim();
  if (search) params.set('search', search);
  if (filters.categoryId !== null) params.set('categoryId', String(filters.categoryId));
  if (filters.status) params.set('status', filters.status);
  params.set('sort', filters.sort);
  params.set('page', String(filters.page));
  params.set('pageSize', String(PAGE_SIZE));
  return params.toString();
}

export function formatAttemptDuration(durationMs: number | null) {
  return durationMs === null ? '—' : `${(durationMs / 1000).toFixed(1)}s`;
}

export function shouldApplyQuestionListResponse(
  signal: AbortSignal,
  requestId: number,
  latestRequestId: number,
) {
  return !signal.aborted && requestId === latestRequestId;
}

function categoryChoices(categories: CategoryNode[]): CategoryChoice[] {
  return categories.flatMap((parent) => [
    { id: parent.id, label: parent.name },
    ...parent.children.map((child) => ({ id: child.id, label: `${parent.name} / ${child.name}` })),
  ]);
}

function LatestResult({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-stone-500">—</span>;
  return value
    ? <span className="font-medium text-emerald-700">正确</span>
    : <span className="font-medium text-red-700">错误</span>;
}

function StatusControl({
  question,
  onChange,
  changing,
}: {
  question: QuestionListItem;
  onChange: (nextStatus: QuestionStatus) => void;
  changing: boolean;
}) {
  return (
    <select
      aria-label={`题目 ${question.id} 的状态`}
      value={question.status}
      disabled={changing}
      onChange={(event) => onChange(event.target.value as QuestionStatus)}
      className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-stone-700 disabled:cursor-not-allowed disabled:text-stone-400"
    >
      {statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
    </select>
  );
}

function MobileQuestionRow({
  question,
  onEdit,
  onStatusChange,
  changing,
}: {
  question: QuestionListItem;
  onEdit: (question: QuestionListItem | null) => void;
  onStatusChange: (question: QuestionListItem, nextStatus: QuestionStatus) => void;
  changing: boolean;
}) {
  return (
    <article className="border-b border-stone-200 px-4 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-stone-500">#{question.id} · {question.categoryPath.join(' / ')}</p>
          <p className="mt-1 line-clamp-2 text-sm font-medium text-stone-900">{question.stem}</p>
        </div>
        <button type="button" onClick={() => onEdit(question)} className="shrink-0 text-sm font-medium text-stone-700 hover:text-stone-950">编辑</button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div><dt className="text-stone-500">最近结果</dt><dd className="mt-0.5"><LatestResult value={question.stats.latestCorrect} /></dd></div>
        <div><dt className="text-stone-500">最近用时</dt><dd className="mt-0.5 text-stone-700">{formatAttemptDuration(question.stats.latestDurationMs)}</dd></div>
        <div><dt className="text-stone-500">答对</dt><dd className="mt-0.5 text-stone-700">{question.stats.correctCount}</dd></div>
        <div><dt className="text-stone-500">答错</dt><dd className="mt-0.5 text-stone-700">{question.stats.wrongCount}</dd></div>
      </dl>
      <div className="mt-3 flex items-center justify-between gap-3">
        <StatusControl question={question} onChange={(status) => onStatusChange(question, status)} changing={changing} />
        {question.status === 'deleted' ? (
          <button type="button" onClick={() => onStatusChange(question, 'learning')} disabled={changing} className="text-xs font-medium text-stone-700 hover:text-stone-950 disabled:text-stone-400">恢复到学习</button>
        ) : null}
      </div>
    </article>
  );
}

export default function QuestionLibrary({
  categories,
  refreshVersion,
  onEdit,
  onChanged,
}: {
  categories: CategoryNode[];
  refreshVersion: number;
  onEdit: (question: QuestionListItem | null) => void;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [status, setStatus] = useState<QuestionStatus | ''>('');
  const [sort, setSort] = useState<Sort>('updated_desc');
  const [page, setPage] = useState(1);
  const [requestVersion, setRequestVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [items, setItems] = useState<QuestionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [changingId, setChangingId] = useState<number | null>(null);
  const latestRequestId = useRef(0);

  const choices = useMemo(() => categoryChoices(categories), [categories]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  async function loadQuestions(controller: AbortController, filters: LibraryFilters, requestId: number) {
    if (!shouldApplyQuestionListResponse(controller.signal, requestId, latestRequestId.current)) return;
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch(`/api/review-questions?${buildQuestionListQuery(filters)}`, { signal: controller.signal });
      if (!shouldApplyQuestionListResponse(controller.signal, requestId, latestRequestId.current)) return;
      const body = await response.json().catch(() => ({}));
      if (!shouldApplyQuestionListResponse(controller.signal, requestId, latestRequestId.current)) return;
      if (!response.ok) throw new Error(body.error ?? '题目加载失败，请重试');
      const result = body as { items: QuestionListItem[]; total: number };
      if (!shouldApplyQuestionListResponse(controller.signal, requestId, latestRequestId.current)) return;
      setItems(result.items);
      setTotal(result.total);
    } catch (error) {
      if (!shouldApplyQuestionListResponse(controller.signal, requestId, latestRequestId.current)) return;
      setLoadError(error instanceof Error ? error.message : '题目加载失败，请重试');
    } finally {
      if (shouldApplyQuestionListResponse(controller.signal, requestId, latestRequestId.current)) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    const filters: LibraryFilters = { search: debouncedSearch, categoryId, status, sort, page };
    const request = window.setTimeout(() => { void loadQuestions(controller, filters, requestId); }, 0);

    return () => {
      window.clearTimeout(request);
      controller.abort();
    };
  }, [categoryId, debouncedSearch, page, refreshVersion, requestVersion, sort, status]);

  async function changeStatus(question: QuestionListItem, nextStatus: QuestionStatus) {
    if (nextStatus === question.status || changingId !== null) return;
    const needsConfirmation = nextStatus === 'inactive' || nextStatus === 'deleted';
    if (needsConfirmation && !window.confirm(`确定将题目 #${question.id} 标记为${statusLabels[nextStatus]}吗？`)) return;

    setChangingId(question.id);
    setActionError('');
    try {
      const response = await fetch(`/api/review-questions/${question.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? '状态更新失败，请重试');
      setRequestVersion((version) => version + 1);
      onChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '状态更新失败，请重试');
    } finally {
      setChangingId(null);
    }
  }

  return (
    <section aria-labelledby="question-library-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-stone-300 pb-3">
        <div>
          <h2 id="question-library-title" className="text-base font-semibold text-stone-900">题目库</h2>
          <p className="mt-1 text-sm text-stone-500">{total} 道题目</p>
        </div>
        <button type="button" onClick={() => onEdit(null)} className="rounded-md bg-stone-800 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700">新增题目</button>
      </div>

      <div className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-stone-600">搜索题干
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="输入关键词" className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900" />
        </label>
        <label className="text-xs font-medium text-stone-600">分类
          <select value={categoryId ?? ''} onChange={(event) => { setCategoryId(event.target.value ? Number(event.target.value) : null); setPage(1); }} className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900">
            <option value="">全部分类</option>
            {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-stone-600">状态
          <select value={status} onChange={(event) => { setStatus(event.target.value as QuestionStatus | ''); setPage(1); }} className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900">
            <option value="">全部状态（不含已删除）</option>
            {statuses.map((itemStatus) => <option key={itemStatus} value={itemStatus}>{statusLabels[itemStatus]}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-stone-600">排序
          <select value={sort} onChange={(event) => { setSort(event.target.value as Sort); setPage(1); }} className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900">
            {(Object.keys(sortLabels) as Sort[]).map((key) => <option key={key} value={key}>{sortLabels[key]}</option>)}
          </select>
        </label>
      </div>

      {loadError ? <div className="mb-3 flex flex-wrap items-center gap-3 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800"><span>{loadError}</span><button type="button" onClick={() => setRequestVersion((version) => version + 1)} className="font-medium underline">重试</button></div> : null}
      {actionError ? <p className="mb-3 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">{actionError}</p> : null}

      <div className="border border-stone-200 bg-white">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs font-medium text-stone-500">
              <tr>
                <th className="px-4 py-3">分类</th><th className="px-4 py-3">题干</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">最近结果</th><th className="px-4 py-3">最近用时</th><th className="px-4 py-3">对</th><th className="px-4 py-3">错</th><th className="px-4 py-3"><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {items.map((question) => (
                <tr key={question.id}>
                  <td className="max-w-40 px-4 py-3 text-xs text-stone-600">{question.categoryPath.join(' / ')}</td>
                  <td className="max-w-72 px-4 py-3"><p className="truncate font-medium text-stone-900" title={question.stem}>{question.stem}</p><p className="mt-1 font-mono text-xs text-stone-500">#{question.id}</p></td>
                  <td className="px-4 py-3"><StatusControl question={question} onChange={(nextStatus) => void changeStatus(question, nextStatus)} changing={changingId === question.id} /></td>
                  <td className="px-4 py-3"><LatestResult value={question.stats.latestCorrect} /></td>
                  <td className="px-4 py-3 font-mono text-xs text-stone-600">{formatAttemptDuration(question.stats.latestDurationMs)}</td>
                  <td className="px-4 py-3 text-stone-700">{question.stats.correctCount}</td>
                  <td className="px-4 py-3 text-stone-700">{question.stats.wrongCount}</td>
                  <td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-3"><button type="button" onClick={() => onEdit(question)} className="font-medium text-stone-700 hover:text-stone-950">编辑</button>{question.status === 'deleted' ? <button type="button" onClick={() => void changeStatus(question, 'learning')} disabled={changingId === question.id} className="font-medium text-stone-700 hover:text-stone-950 disabled:text-stone-400">恢复</button> : null}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="md:hidden">
          {items.map((question) => <MobileQuestionRow key={question.id} question={question} onEdit={onEdit} onStatusChange={(item, nextStatus) => void changeStatus(item, nextStatus)} changing={changingId === question.id} />)}
        </div>
        {!loading && items.length === 0 ? <p className="px-4 py-10 text-center text-sm text-stone-500">当前筛选条件下没有题目。</p> : null}
        {loading ? <p className="px-4 py-8 text-center text-sm text-stone-500">正在加载题目…</p> : null}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-sm text-stone-600">
        <span>第 {page} / {totalPages} 页</span>
        <div className="flex gap-2">
          <button type="button" disabled={page === 1 || loading} onClick={() => setPage((current) => current - 1)} className="rounded-md border border-stone-300 bg-white px-3 py-1.5 font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-400">上一页</button>
          <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)} className="rounded-md border border-stone-300 bg-white px-3 py-1.5 font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-400">下一页</button>
        </div>
      </div>
    </section>
  );
}
