'use client';

import { useState } from 'react';
import type { ReadingNoteCategory } from '@/lib/readingNotes/types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as { error?: string }).error ?? '分类操作失败，请重试');
  }
  return body as T;
}

export default function ReadingCategoryManager({
  categories,
  onChanged,
}: {
  categories: ReadingNoteCategory[];
  onChanged: (categories: ReadingNoteCategory[]) => void;
}) {
  const active = categories.filter((category) => category.status === 'active');
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ReadingNoteCategory | null>(null);
  const [deleteDestination, setDeleteDestination] = useState<string>('uncategorized');
  const [mergeSource, setMergeSource] = useState<ReadingNoteCategory | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    const next = await requestJson<ReadingNoteCategory[]>('/api/reading-note-categories');
    onChanged(next);
  }

  async function createCategory() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError('');
    try {
      const created = await requestJson<ReadingNoteCategory>('/api/reading-note-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      onChanged([...active, created]);
      setNewName('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '分类新增失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  async function renameCategory(category: ReadingNoteCategory) {
    const name = editingName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await requestJson<ReadingNoteCategory>(
        `/api/reading-note-categories/${category.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      );
      onChanged(active.map((item) => item.id === updated.id ? updated : item));
      setEditingId(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '分类重命名失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  async function reorder(category: ReadingNoteCategory, offset: -1 | 1) {
    const index = active.findIndex((item) => item.id === category.id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= active.length || busy) return;
    const reordered = [...active];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onChanged(reordered);
    setBusy(true);
    setError('');
    try {
      const saved = await requestJson<ReadingNoteCategory[]>('/api/reading-note-categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: reordered.map((item) => item.id) }),
      });
      onChanged(saved);
    } catch (nextError) {
      onChanged(active);
      setError(nextError instanceof Error ? nextError.message : '分类排序失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  async function deleteCategory() {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setError('');
    const destination = deleteTarget.noteCount === 0
      ? null
      : deleteDestination === 'uncategorized'
        ? 'uncategorized'
        : Number(deleteDestination);
    try {
      const response = await fetch(`/api/reading-note-categories/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? '分类删除失败，请重试');
      }
      setDeleteTarget(null);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '分类删除失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  async function mergeCategory() {
    if (!mergeSource || !mergeTargetId || busy) return;
    setBusy(true);
    setError('');
    try {
      await requestJson(`/api/reading-note-categories/${mergeSource.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCategoryId: Number(mergeTargetId) }),
      });
      setMergeSource(null);
      setMergeTargetId('');
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '分类合并失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="阅读笔记分类管理">
      <div className="border-b border-stone-200 pb-5">
        <label htmlFor="new-reading-category" className="text-sm font-medium text-stone-800">新增分类</label>
        <div className="mt-2 flex gap-2">
          <input
            id="new-reading-category"
            aria-label="新分类名称"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void createCategory(); }}
            placeholder="例如：固定搭配"
            className="min-w-0 flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm"
          />
          <button type="button" onClick={() => void createCategory()} disabled={busy || !newName.trim()} className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:bg-stone-300">
            新增分类
          </button>
        </div>
      </div>

      {error ? <p role="alert" className="mt-4 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

      <ul className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
        {active.map((category, index) => (
          <li key={category.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              {editingId === category.id ? (
                <div className="flex gap-2">
                  <input autoFocus aria-label="分类名称" value={editingName} onChange={(event) => setEditingName(event.target.value)} className="min-w-0 flex-1 rounded-md border border-stone-400 px-2 py-1 text-sm" />
                  <button type="button" onClick={() => void renameCategory(category)} disabled={busy} className="text-sm font-medium text-stone-900">保存</button>
                  <button type="button" onClick={() => setEditingId(null)} disabled={busy} className="text-sm text-stone-500">取消</button>
                </div>
              ) : (
                <>
                  <p className="truncate text-sm font-medium text-stone-900">{category.name}</p>
                  <p className="mt-0.5 text-xs text-stone-500">{category.noteCount} 条知识点{category.isDefault ? ' · 系统分类' : ''}</p>
                </>
              )}
            </div>
            {editingId !== category.id ? (
              <div className="flex items-center gap-1">
                <button type="button" aria-label="上移分类" title="上移" onClick={() => void reorder(category, -1)} disabled={busy || index === 0} className="h-8 w-8 rounded-md text-stone-500 hover:bg-stone-100 disabled:text-stone-200">↑</button>
                <button type="button" aria-label="下移分类" title="下移" onClick={() => void reorder(category, 1)} disabled={busy || index === active.length - 1} className="h-8 w-8 rounded-md text-stone-500 hover:bg-stone-100 disabled:text-stone-200">↓</button>
                {!category.isDefault ? (
                  <>
                    <button type="button" aria-label="重命名分类" title="重命名" onClick={() => { setEditingId(category.id); setEditingName(category.name); }} disabled={busy} className="h-8 w-8 rounded-md text-stone-500 hover:bg-stone-100">✎</button>
                    <button type="button" aria-label="合并分类" title="合并" onClick={() => { setMergeSource(category); setMergeTargetId(''); }} disabled={busy} className="h-8 w-8 rounded-md text-stone-500 hover:bg-stone-100">⇥</button>
                    <button type="button" aria-label="删除分类" title="删除" onClick={() => { setDeleteTarget(category); setDeleteDestination('uncategorized'); }} disabled={busy} className="h-8 w-8 rounded-md text-stone-400 hover:bg-red-50 hover:text-red-700">🗑️</button>
                  </>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {mergeSource ? (
        <div role="dialog" aria-label="合并分类" className="mt-4 border border-stone-300 bg-stone-50 p-4">
          <p className="text-sm font-medium text-stone-900">将“{mergeSource.name}”合并到</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select aria-label="目标分类" value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)} className="min-w-48 flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm">
              <option value="">选择目标分类</option>
              {active.filter((item) => item.id !== mergeSource.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button type="button" onClick={() => void mergeCategory()} disabled={busy || !mergeTargetId} className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:bg-stone-300">确认合并</button>
            <button type="button" onClick={() => setMergeSource(null)} disabled={busy} className="px-3 py-2 text-sm text-stone-600">取消</button>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div role="alertdialog" aria-label="删除分类" className="mt-4 border-l-2 border-red-700 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">删除“{deleteTarget.name}”</p>
          {deleteTarget.noteCount > 0 ? (
            <label className="mt-3 block text-sm text-red-900">
              其中 {deleteTarget.noteCount} 条知识点将
              <select value={deleteDestination} onChange={(event) => setDeleteDestination(event.target.value)} className="mt-1 block w-full rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-stone-900">
                <option value="uncategorized">移到未分类</option>
                {active.filter((item) => item.id !== deleteTarget.id && !item.isDefault).map((item) => <option key={item.id} value={item.id}>移到“{item.name}”</option>)}
              </select>
            </label>
          ) : <p className="mt-2 text-sm text-red-800">此分类中没有知识点。</p>}
          <div className="mt-3 flex gap-3">
            <button type="button" onClick={() => void deleteCategory()} disabled={busy} className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:bg-red-300">删除分类</button>
            <button type="button" onClick={() => setDeleteTarget(null)} disabled={busy} className="px-3 py-2 text-sm text-stone-600">取消</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
