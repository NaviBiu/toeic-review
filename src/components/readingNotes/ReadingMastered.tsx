'use client';

import { useEffect, useRef, useState } from 'react';
import Pagination from '@/components/Pagination';
import type { ReadingNote } from '@/lib/readingNotes/types';
import { RichReadingContent } from './RichReadingContent';

export type ReadingMasteredPage = {
  items: ReadingNote[];
  total: number;
  page: number;
  pageSize: number;
};

type UndoState = { note: ReadingNote; index: number; undoToken: string };

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? fallback);
  return body as T;
}

function insertAt(items: ReadingNote[], item: ReadingNote, index: number) {
  const bounded = Math.max(0, Math.min(index, items.length));
  return [...items.slice(0, bounded), item, ...items.slice(bounded)];
}

export default function ReadingMastered({
  initialPage,
  onCountChange,
}: {
  initialPage: ReadingMasteredPage;
  onCountChange?: (count: number) => void;
}) {
  const [result, setResult] = useState(initialPage);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [loading, setLoading] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onCountChange?.(result.total);
  }, [onCountChange, result.total]);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  async function restore(note: ReadingNote) {
    if (!window.confirm(`确定要把「${note.contentText}」移回错题库吗?它会重新进入今天的复盘队列,连续答对次数会清零。`)) return;
    const snapshot = result;
    setResult((current) => ({ ...current, total: Math.max(0, current.total - 1), items: current.items.filter((item) => item.id !== note.id) }));
    setError('');
    try {
      const response = await fetch(`/api/reading-notes/${note.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      await readJson(response, '操作失败，请重试');
      setMessage('已移回阅读笔记，今天会重新出现在复盘队列');
      window.setTimeout(() => setMessage(''), 4000);
    } catch (nextError) {
      setResult(snapshot);
      setError(nextError instanceof Error ? nextError.message : '操作失败，请重试');
    }
  }

  async function deleteNote(note: ReadingNote, index: number) {
    const snapshot = result;
    setResult((current) => ({ ...current, total: Math.max(0, current.total - 1), items: current.items.filter((item) => item.id !== note.id) }));
    setError('');
    try {
      const response = await fetch(`/api/reading-notes/${note.id}`, { method: 'DELETE' });
      const body = await readJson<{ undoToken: string }>(response, '删除失败，请重试');
      setUndo({ note, index, undoToken: body.undoToken });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 5000);
    } catch (nextError) {
      setResult(snapshot);
      setError(nextError instanceof Error ? nextError.message : '删除失败，请重试');
    }
  }

  async function undoDelete() {
    if (!undo) return;
    const restore = undo;
    const snapshot = result;
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setResult((current) => ({ ...current, total: current.total + 1, items: insertAt(current.items, restore.note, restore.index) }));
    try {
      const response = await fetch(`/api/reading-notes/${restore.note.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'restore', undoToken: restore.undoToken }),
      });
      await readJson(response, '撤销失败，请重试');
    } catch (nextError) {
      setResult(snapshot);
      setUndo(restore);
      setError(nextError instanceof Error ? nextError.message : '撤销失败，请重试');
    }
  }

  async function loadPage(page: number) {
    setLoading(true);
    try {
      const response = await fetch(`/api/reading-notes?status=mastered&page=${page}&pageSize=${result.pageSize}`);
      setResult(await readJson<ReadingMasteredPage>(response, '已掌握笔记加载失败'));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '已掌握笔记加载失败');
    } finally {
      setLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return (
    <section aria-label="阅读已掌握">
      {message ? <p className="mb-4 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p role="alert" className="mb-4 text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="py-10 text-center text-sm text-stone-500">正在加载…</p> : null}
      {!loading && result.items.length === 0 ? <div className="border border-stone-200 bg-white p-10 text-center text-stone-500">还没有已掌握的阅读笔记</div> : null}
      {!loading && result.items.length > 0 ? <ul className="divide-y divide-stone-200 border-y border-stone-200">{result.items.map((note, index) => <li key={note.id} className="py-5"><div className="flex items-start gap-4"><div className="min-w-0 flex-1"><p className="mb-3 text-xs text-stone-500"><span className="font-medium text-stone-700">{note.categoryName}</span> · {note.noteDate}</p><RichReadingContent html={note.contentHtml} />{note.notes ? <p className="mt-3 border-l-2 border-stone-300 pl-3 text-sm text-stone-600">{note.notes}</p> : null}</div><div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => void restore(note)} className="px-2 py-2 text-sm font-medium text-indigo-700">移回错题库</button><button type="button" aria-label="永久删除" title="永久删除" onClick={() => void deleteNote(note, index)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-stone-400 hover:bg-red-50 hover:text-red-700">🗑️</button></div></div></li>)}</ul> : null}
      <Pagination page={Math.min(result.page, totalPages)} totalPages={totalPages} onChange={(page) => void loadPage(page)} />
      {undo ? <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md bg-stone-900 px-4 py-3 text-sm text-white shadow-lg">已删除「{undo.note.contentText}」<button type="button" onClick={() => void undoDelete()} className="font-medium underline">撤销</button></div> : null}
    </section>
  );
}
