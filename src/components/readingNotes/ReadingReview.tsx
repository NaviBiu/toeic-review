'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ReviewItemActions from '@/components/ReviewItemActions';
import { workReadingReviewCopy, workReviewCopy } from '@/lib/disguiseMode';
import type {
  ReadingDecision,
  ReadingNote,
  ReadingNoteCategory,
  ReadingQueuePage,
} from '@/lib/readingNotes/types';
import { RichReadingContent } from './RichReadingContent';

type PreviousDecision = {
  attemptId: number;
  requestId: string;
  note: ReadingNote;
  decision: ReadingDecision;
};

type RetryAction =
  | { type: 'decision'; decision: ReadingDecision }
  | { type: 'correction'; decision: ReadingDecision }
  | { type: 'status'; status: 'mastered' | 'deleted' }
  | null;

type UndoDelete = {
  note: ReadingNote;
  index: number;
  undoToken: string;
};

type ReadingReviewProps = {
  mode: 'study' | 'work';
  prefetched?: ReadingQueuePage;
  onPendingChange?: (count: number) => void;
};

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? fallback);
  return body as T;
}

function removeLastRepeat(queue: ReadingNote[], noteId: number) {
  const index = queue.findLastIndex((item) => item.id === noteId);
  if (index < 0) return queue;
  return [...queue.slice(0, index), ...queue.slice(index + 1)];
}

function insertAt(queue: ReadingNote[], note: ReadingNote, index: number) {
  const bounded = Math.max(0, Math.min(index, queue.length));
  return [...queue.slice(0, bounded), note, ...queue.slice(bounded)];
}

export default function ReadingReview({ mode, prefetched, onPendingChange }: ReadingReviewProps) {
  const [started, setStarted] = useState(false);
  const [queue, setQueue] = useState<ReadingNote[]>(() => prefetched?.items ?? []);
  const [pending, setPending] = useState(prefetched?.totalPending ?? 0);
  const [hasMore, setHasMore] = useState(prefetched?.hasMore ?? false);
  const [previous, setPrevious] = useState<PreviousDecision | null>(null);
  const [categories, setCategories] = useState<ReadingNoteCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [loading, setLoading] = useState(!prefetched);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<RetryAction>(null);
  const [undo, setUndo] = useState<UndoDelete | null>(null);
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const refillInFlight = useRef(false);

  const work = mode === 'work';
  const current = queue[0];

  useEffect(() => onPendingChange?.(pending), [onPendingChange, pending]);

  useEffect(() => {
    let active = true;
    fetch('/api/reading-note-categories')
      .then((response) => readJson<ReadingNoteCategory[]>(response, '分类加载失败'))
      .then((items) => { if (active) setCategories(items); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const loadQueue = useCallback(async (selectedCategory = categoryId) => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: '50' });
    if (selectedCategory) params.set('categoryId', selectedCategory);
    try {
      const response = await fetch(`/api/reading-review/queue?${params}`);
      const page = await readJson<ReadingQueuePage>(response, '阅读复盘加载失败，请重试');
      setQueue(page.items);
      setPending(page.totalPending);
      setHasMore(page.hasMore);
      setPrevious(null);
      setRetry(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '阅读复盘加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [categoryId]);

  useEffect(() => {
    if (prefetched) return;
    let active = true;
    const params = new URLSearchParams({ limit: '50' });
    fetch(`/api/reading-review/queue?${params}`)
      .then((response) => readJson<ReadingQueuePage>(response, '阅读复盘加载失败，请重试'))
      .then((page) => {
        if (!active) return;
        setQueue(page.items);
        setPending(page.totalPending);
        setHasMore(page.hasMore);
        setLoading(false);
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : '阅读复盘加载失败，请重试');
        setLoading(false);
      });
    return () => { active = false; };
  }, [prefetched]);

  function changeCategory(nextCategoryId: string) {
    setCategoryId(nextCategoryId);
    setStarted(false);
    void loadQueue(nextCategoryId);
  }

  function enqueueWrite(operation: () => Promise<void>, onFailure: (message: string) => void) {
    setSaving(true);
    const queued = writeChain.current.then(operation);
    writeChain.current = queued.then(() => undefined, () => undefined);
    queued.catch((nextError) => {
      onFailure(nextError instanceof Error ? nextError.message : '保存失败，请重试');
    }).finally(() => setSaving(false));
  }

  function decide(decision: ReadingDecision) {
    if (!current || saving) return;
    const snapshot = { queue, pending, previous };
    const requestId = crypto.randomUUID();
    const nextQueue = queue.slice(1);
    if (decision === 'unknown') nextQueue.push(current);
    setQueue(nextQueue);
    setPending(Math.max(0, pending - 1) + (decision === 'unknown' ? 1 : 0));
    setPrevious({ attemptId: 0, requestId, note: current, decision });
    setError('');
    setRetry(null);

    enqueueWrite(async () => {
      const response = await fetch('/api/reading-review/attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, noteId: current.id, decision }),
      });
      const result = await readJson<{ attempt: { id: number } }>(
        response,
        '复盘结果保存失败，请重试',
      );
      setPrevious((value) => value?.requestId === requestId
        ? { ...value, attemptId: result.attempt.id }
        : value);
    }, (message) => {
      setQueue(snapshot.queue);
      setPending(snapshot.pending);
      setPrevious(snapshot.previous);
      setError(message);
      setRetry({ type: 'decision', decision });
    });
  }

  function correctPrevious(decision?: ReadingDecision) {
    if (!previous || previous.attemptId <= 0 || saving) return;
    const nextDecision = decision ?? (previous.decision === 'known' ? 'unknown' : 'known');
    if (nextDecision === previous.decision) return;
    const snapshot = { queue, pending, previous };
    const nextQueue = previous.decision === 'unknown'
      ? removeLastRepeat(queue, previous.note.id)
      : [...queue, previous.note];
    const nextPending = previous.decision === 'unknown'
      ? Math.max(0, pending - 1)
      : pending + 1;
    setQueue(nextQueue);
    setPending(nextPending);
    setPrevious({ ...previous, decision: nextDecision });
    setError('');
    setRetry(null);

    enqueueWrite(async () => {
      const response = await fetch(`/api/reading-review/attempts/${previous.attemptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: nextDecision }),
      });
      await readJson(response, '上一条结果修改失败，请重试');
    }, (message) => {
      setQueue(snapshot.queue);
      setPending(snapshot.pending);
      setPrevious(snapshot.previous);
      setError(message);
      setRetry({ type: 'correction', decision: nextDecision });
    });
  }

  useEffect(() => {
    if (!started || queue.length >= 10 || !hasMore || saving || refillInFlight.current) return;
    refillInFlight.current = true;
    const params = new URLSearchParams({ limit: '50' });
    if (categoryId) params.set('categoryId', categoryId);
    fetch(`/api/reading-review/queue?${params}`)
      .then((response) => readJson<ReadingQueuePage>(response, ''))
      .then((page) => {
        setQueue((currentQueue) => {
          const ids = new Set(currentQueue.map((item) => item.id));
          return [...currentQueue, ...page.items.filter((item) => !ids.has(item.id))];
        });
        setHasMore(page.hasMore);
      })
      .catch(() => undefined)
      .finally(() => { refillInFlight.current = false; });
  }, [categoryId, hasMore, queue.length, saving, started]);

  function updateCurrentStatus(status: 'mastered' | 'deleted') {
    if (!current || saving) return;
    const snapshot = { queue, pending, previous };
    const originalIndex = 0;
    setQueue(queue.filter((item) => item.id !== current.id));
    setPending(Math.max(0, pending - 1));
    if (previous?.note.id === current.id) setPrevious(null);
    setError('');
    setRetry(null);

    enqueueWrite(async () => {
      const response = await fetch(`/api/reading-notes/${current.id}`, status === 'deleted'
        ? { method: 'DELETE' }
        : {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'mastered' }),
          });
      if (status === 'deleted') {
        const result = await readJson<{ undoToken: string }>(response, '删除失败，请重试');
        setUndo({ note: current, index: originalIndex, undoToken: result.undoToken });
        window.setTimeout(() => setUndo((value) => (
          value?.undoToken === result.undoToken ? null : value
        )), 5000);
      } else {
        await readJson(response, '标记已掌握失败，请重试');
      }
    }, (message) => {
      setQueue(snapshot.queue);
      setPending(snapshot.pending);
      setPrevious(snapshot.previous);
      setError(message);
      setRetry({ type: 'status', status });
    });
  }

  async function undoDelete() {
    if (!undo || saving) return;
    const snapshot = { queue, pending };
    const restore = undo;
    setQueue(insertAt(queue, restore.note, restore.index));
    setPending(pending + 1);
    setUndo(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/reading-notes/${restore.note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'restore', undoToken: restore.undoToken }),
      });
      await readJson(response, '撤销失败，请重试');
    } catch (nextError) {
      setQueue(snapshot.queue);
      setPending(snapshot.pending);
      setUndo(restore);
      setError(nextError instanceof Error ? nextError.message : '撤销失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  function retrySave() {
    if (!retry) return;
    const action = retry;
    setRetry(null);
    if (action.type === 'decision') decide(action.decision);
    else if (action.type === 'correction') correctPrevious(action.decision);
    else updateCurrentStatus(action.status);
  }

  const previousLabel = previous
    ? (work
        ? (previous.decision === 'known'
            ? workReadingReviewCopy.previousKnown
            : workReadingReviewCopy.previousUnknown)
        : `上一条：${previous.decision === 'known' ? '知道' : '不知道'}`)
    : '';

  const controls = (
    <>
      {previous ? (
        <div className={`flex flex-wrap items-center justify-between gap-3 ${work ? 'border-y border-slate-200 py-3 font-mono text-xs' : 'border-b border-stone-200 pb-4 text-sm'}`}>
          <span className={previous.decision === 'known' ? 'text-emerald-700' : 'text-amber-700'}>{previousLabel}</span>
          <button
            type="button"
            onClick={() => correctPrevious()}
            disabled={saving || previous.attemptId <= 0}
            title={work ? workReadingReviewCopy.changePrevious : '修改上一条结果'}
            aria-label={work ? workReadingReviewCopy.changePrevious : '修改上一条结果'}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-40 ${work ? 'text-slate-600 hover:bg-slate-100' : 'text-stone-500 hover:bg-stone-100'}`}
          >
            <span aria-hidden="true">↺</span>
          </button>
        </div>
      ) : null}

      {current ? (
        <article className={work ? 'mt-5 border border-slate-300 bg-white' : 'mt-5 border-y border-stone-200 bg-white py-6'}>
          {work ? (
            <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 font-mono text-[11px] uppercase text-slate-500">
              <span>{workReadingReviewCopy.tab}</span><span>{pending} items pending</span>
            </header>
          ) : null}
          <div className={work ? 'p-6' : ''}>
            <div className={`flex flex-wrap gap-x-5 gap-y-1 ${work ? 'font-mono text-[11px] text-slate-500' : 'text-xs text-stone-500'}`}>
              <span>{work ? workReadingReviewCopy.category : '分类'}：{current.categoryName}</span>
              <span>{work ? workReadingReviewCopy.noteDate : '日期'}：{current.noteDate}</span>
            </div>
            <div className="mt-5"><RichReadingContent html={current.contentHtml} /></div>
            {current.notes ? <p className={`mt-4 border-l-2 pl-3 text-sm leading-6 ${work ? 'border-slate-400 text-slate-600' : 'border-stone-300 text-stone-600'}`}>{current.notes}</p> : null}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" disabled={saving} onClick={() => decide('known')} className={`py-3 text-sm font-medium disabled:opacity-50 ${work ? 'border border-slate-700 bg-slate-700 font-mono text-white hover:bg-slate-800' : 'rounded-md bg-emerald-700 text-white hover:bg-emerald-800'}`}>{work ? workReadingReviewCopy.known : '知道'}</button>
              <button type="button" disabled={saving} onClick={() => decide('unknown')} className={`py-3 text-sm font-medium disabled:opacity-50 ${work ? 'border border-slate-300 bg-white font-mono text-slate-700 hover:bg-slate-50' : 'rounded-md border border-stone-300 bg-white text-stone-700 hover:bg-stone-100'}`}>{work ? workReadingReviewCopy.unknown : '不知道'}</button>
            </div>
            <ReviewItemActions
              mode={mode}
              onMastered={() => updateCurrentStatus('mastered')}
              onDelete={() => updateCurrentStatus('deleted')}
              masteredLabel={work ? undefined : '标记为已掌握'}
              deleteLabel={work ? undefined : '永久删除'}
              className={`mt-4 justify-end ${work ? 'border-t border-slate-200 pt-3' : ''}`}
            />
          </div>
        </article>
      ) : started && !loading ? (
        <div className={`py-10 text-center ${work ? 'font-mono text-sm text-slate-600' : 'text-stone-500'}`}>
          {work ? 'No review items are pending today.' : '今天的阅读复盘已完成'}
        </div>
      ) : null}
    </>
  );

  const startPanel = !started ? (
    <div className={work ? 'border-y border-slate-200 py-6' : 'border-y border-stone-200 py-6'}>
      <div className="flex flex-wrap items-end gap-3">
        <label className={`flex min-w-48 flex-1 flex-col gap-2 text-xs ${work ? 'font-mono uppercase text-slate-500' : 'text-stone-600'}`}>
          {work ? workReadingReviewCopy.category : '复盘分类'}
          <select value={categoryId} onChange={(event) => changeCategory(event.target.value)} className={`h-10 border bg-white px-3 text-sm normal-case ${work ? 'border-slate-300 font-mono text-slate-700' : 'rounded-md border-stone-300 text-stone-700'}`}>
            <option value="">{work ? 'All workstreams' : '全部分类'}</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setStarted(true)} disabled={loading || pending === 0} className={`h-10 px-5 text-sm font-medium disabled:opacity-40 ${work ? 'border border-slate-700 bg-slate-700 font-mono text-white' : 'rounded-md bg-stone-900 text-white hover:bg-stone-800'}`}>
          {work ? workReadingReviewCopy.start : '开始阅读复盘'}
        </button>
      </div>
      <p className={`mt-4 text-sm ${work ? 'font-mono text-slate-600' : 'text-stone-600'}`}>{work ? workReviewCopy.pending(pending) : `待复盘 ${pending} 条`}</p>
    </div>
  ) : null;

  const errorPanel = error ? (
    <div className={`mt-4 flex items-center justify-between gap-3 border-l-2 px-3 py-2 text-sm ${work ? 'border-amber-600 bg-amber-50 text-amber-900' : 'border-red-600 bg-red-50 text-red-800'}`}>
      <span>{work ? 'Unable to record this decision. Please try again.' : error}</span>
      {retry ? <button type="button" onClick={retrySave} className="shrink-0 font-medium underline">{work ? 'Retry' : '重试保存'}</button> : null}
    </div>
  ) : null;

  const content = (
    <>
      {errorPanel}
      {loading ? <p className={`py-10 text-center text-sm ${work ? 'font-mono text-slate-500' : 'text-stone-500'}`}>{work ? 'Loading review items...' : '加载中…'}</p> : startPanel}
      {started ? controls : null}
    </>
  );

  return (
    <section aria-label={work ? workReadingReviewCopy.tab : '阅读复盘'}>
      {work ? (
        <div className="work-review-document mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <section className="work-review-document-sheet border border-slate-300 bg-white shadow-sm">
            <header className="border-b border-slate-200 px-6 py-6 sm:px-8">
              <p className="font-mono text-[11px] uppercase text-slate-400">Internal requirements document / section 02</p>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                <h1 className="font-mono text-2xl font-semibold text-slate-950">Daily Review Requirements</h1>
                <span className="border border-slate-300 px-2 py-1 font-mono text-[11px] text-slate-600">{workReviewCopy.pending(pending)}</span>
              </div>
            </header>
            <div className="p-6 sm:p-8">
              <div className="grid gap-8 border-b border-slate-200 pb-7 lg:grid-cols-[1.15fr_.85fr]">
                <div><p className="font-mono text-[11px] uppercase text-slate-500">Document purpose</p><p className="mt-3 text-sm leading-7 text-slate-600">Review active reference material and record whether each item is ready for routine use.</p></div>
                <div className="grid grid-cols-2 border border-slate-300 font-mono text-xs"><div className="border-b border-r border-slate-300 p-3 text-slate-500">Review type<p className="mt-1 text-slate-900">{workReadingReviewCopy.tab}</p></div><div className="border-b border-slate-300 p-3 text-slate-500">Status<p className="mt-1 text-slate-900">In review</p></div><div className="border-r border-slate-300 p-3 text-slate-500">Owner<p className="mt-1 text-slate-900">Language Ops</p></div><div className="p-3 text-slate-500">Revision<p className="mt-1 text-slate-900">0.8</p></div></div>
              </div>
              <div className="mt-7">{content}</div>
            </div>
          </section>
        </div>
      ) : (
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-stone-900">阅读复盘</h2>
            <span className="text-sm text-stone-500">剩余 {pending} 条</span>
          </div>
          {content}
        </div>
      )}

      {undo ? (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md bg-stone-900 px-4 py-3 text-sm text-white shadow-lg">
          <span>{work ? 'Item removed.' : `已删除「${undo.note.contentText}」`}</span>
          <button type="button" onClick={() => void undoDelete()} className="font-medium underline">{work ? 'Restore' : '撤销'}</button>
        </div>
      ) : null}
    </section>
  );
}
