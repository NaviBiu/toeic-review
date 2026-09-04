'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import Pagination from '@/components/Pagination';
import type { ReadingNote, ReadingNoteCategory } from '@/lib/readingNotes/types';
import ReadingCategoryManager, { type ReadingCategoryMutation } from './ReadingCategoryManager';
import ReadingNoteEditor, { type ReadingNoteSaveInput } from './ReadingNoteEditor';
import { RichReadingContent } from './RichReadingContent';

type ReadingNotesPage = {
  items: ReadingNote[];
  total: number;
  page: number;
  pageSize: number;
};

const EMPTY_PAGE: ReadingNotesPage = { items: [], total: 0, page: 1, pageSize: 20 };

async function responseJson<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? fallback);
  return body as T;
}

function matchesStatus(note: ReadingNote, status: string) {
  return !status || note.status === status;
}

export function applyReadingCategoryMutation(
  note: ReadingNote,
  mutation: ReadingCategoryMutation,
) {
  if (note.categoryId !== mutation.sourceId || mutation.targetId === null || !mutation.targetName) {
    return note;
  }
  return {
    ...note,
    categoryId: mutation.targetId,
    categoryName: mutation.targetName,
  };
}

export default function ReadingNoteLibrary({
  initialCategories,
  initialPage,
}: {
  initialCategories?: ReadingNoteCategory[] | null;
  initialPage?: ReadingNotesPage | null;
}) {
  const [categories, setCategories] = useState(initialCategories ?? []);
  const [result, setResult] = useState(initialPage ?? EMPTY_PAGE);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('active');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(!initialPage);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<ReadingNote | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [undo, setUndo] = useState<{ note: ReadingNote; token: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didSetFilters = useRef(false);

  const fetchCategories = useCallback(async () => {
    const response = await fetch('/api/reading-note-categories');
    return responseJson<ReadingNoteCategory[]>(response, '分类加载失败，请重试');
  }, []);

  const fetchNotes = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (search) params.set('search', search);
    if (categoryId) params.set('categoryId', categoryId);
    if (status) params.set('status', status);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const response = await fetch(`/api/reading-notes?${params}`);
    return responseJson<ReadingNotesPage>(response, '阅读笔记加载失败，请重试');
  }, [categoryId, dateFrom, dateTo, page, search, status]);

  useEffect(() => {
    if (initialCategories) return;
    let active = true;
    void fetchCategories().then((next) => {
      if (active) setCategories(next);
    }).catch((nextError) => {
      if (active) setError(nextError instanceof Error ? nextError.message : '分类加载失败，请重试');
    });
    return () => { active = false; };
  }, [fetchCategories, initialCategories]);

  useEffect(() => {
    if (!didSetFilters.current) {
      didSetFilters.current = true;
      if (initialPage) return;
    }
    let active = true;
    void fetchNotes().then((next) => {
      if (!active) return;
      setResult(next);
      setError('');
      setLoading(false);
    }).catch((nextError) => {
      if (!active) return;
      setError(nextError instanceof Error ? nextError.message : '阅读笔记加载失败，请重试');
      setLoading(false);
    });
    return () => { active = false; };
  }, [fetchNotes, initialPage]);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  function revalidateNotes() {
    void fetchNotes().then((nextPage) => {
      setResult(nextPage);
    }).catch(() => undefined);
  }

  async function saveNote(input: ReadingNoteSaveInput) {
    setSaving(true);
    setSaveError('');
    try {
      const response = await fetch(
        editingNote ? `/api/reading-notes/${editingNote.id}` : '/api/reading-notes',
        {
          method: editingNote ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      );
      const saved = await responseJson<ReadingNote>(response, '保存失败，请重试');
      setResult((current) => {
        if (editingNote) {
          return {
            ...current,
            items: current.items
              .map((item) => item.id === saved.id ? saved : item)
              .filter((item) => matchesStatus(item, status)),
          };
        }
        if (page !== 1 || !matchesStatus(saved, status)) return current;
        return {
          ...current,
          total: current.total + 1,
          items: [saved, ...current.items].slice(0, current.pageSize),
        };
      });
      setEditorOpen(false);
      setEditingNote(null);
      revalidateNotes();
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  async function markMastered(note: ReadingNote) {
    const before = result;
    setResult((current) => ({
      ...current,
      total: status === 'active' ? Math.max(0, current.total - 1) : current.total,
      items: status === 'active'
        ? current.items.filter((item) => item.id !== note.id)
        : current.items.map((item) => item.id === note.id ? { ...item, status: 'mastered' } : item),
    }));
    try {
      const response = await fetch(`/api/reading-notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'mastered' }),
      });
      await responseJson<ReadingNote>(response, '标记失败，请重试');
      revalidateNotes();
    } catch (nextError) {
      setResult(before);
      setError(nextError instanceof Error ? nextError.message : '标记失败，请重试');
    }
  }

  async function deleteNote(note: ReadingNote) {
    const before = result;
    setResult((current) => ({
      ...current,
      total: Math.max(0, current.total - 1),
      items: current.items.filter((item) => item.id !== note.id),
    }));
    setError('');
    try {
      const response = await fetch(`/api/reading-notes/${note.id}`, { method: 'DELETE' });
      const body = await responseJson<{ note: ReadingNote; undoToken: string }>(
        response,
        '删除失败，请重试',
      );
      setUndo({ note, token: body.undoToken });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 5000);
      revalidateNotes();
    } catch (nextError) {
      setResult(before);
      setError(nextError instanceof Error ? nextError.message : '删除失败，请重试');
    }
  }

  async function undoDelete() {
    if (!undo) return;
    const currentUndo = undo;
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    try {
      const response = await fetch(`/api/reading-notes/${currentUndo.note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'restore', undoToken: currentUndo.token }),
      });
      const restored = await responseJson<ReadingNote>(response, '撤销失败，请重试');
      if (matchesStatus(restored, status) && page === 1) {
        setResult((current) => ({
          ...current,
          total: current.total + 1,
          items: [restored, ...current.items].slice(0, current.pageSize),
        }));
      }
      revalidateNotes();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '撤销失败，请重试');
    }
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <section aria-label="阅读笔记">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-500">共 {result.total} 条</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setCategoryManagerOpen(true)} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100">
            管理分类
          </button>
          <button type="button" onClick={() => { setEditingNote(null); setSaveError(''); setEditorOpen(true); }} className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">
            新增阅读笔记
          </button>
        </div>
      </div>

      <form
        className="mt-5 grid gap-2 border-y border-stone-200 py-4 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1.4fr)_repeat(4,minmax(8rem,1fr))_auto]"
        onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchDraft.trim()); }}
      >
        <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索知识点或备注" className="min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm" />
        <select aria-label="分类筛选" value={categoryId} onChange={(event) => { setPage(1); setCategoryId(event.target.value); }} className="min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm">
          <option value="">全部分类</option>
          {categories.filter((category) => category.status === 'active').map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select aria-label="状态筛选" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} className="min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm">
          <option value="active">学习中</option>
          <option value="mastered">已掌握</option>
        </select>
        <input aria-label="开始日期" type="date" value={dateFrom} onChange={(event) => { setPage(1); setDateFrom(event.target.value); }} className="min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm" />
        <input aria-label="结束日期" type="date" value={dateTo} onChange={(event) => { setPage(1); setDateTo(event.target.value); }} className="min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm" />
        <button type="submit" className="rounded-md border border-stone-800 px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100">搜索</button>
      </form>

      {error ? <p role="alert" className="mt-4 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {loading ? <p className="py-12 text-center text-sm text-stone-500">正在加载…</p> : null}

      {!loading ? (
        <ul className="divide-y divide-stone-200">
          {result.items.map((note) => (
            <li key={note.id} className="py-5">
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                    <span className="font-medium text-stone-700">{note.categoryName}</span>
                    <time dateTime={note.noteDate}>{note.noteDate}</time>
                    {note.status === 'mastered' ? <span className="text-emerald-700">已掌握</span> : null}
                  </div>
                  <RichReadingContent html={note.contentHtml} />
                  {note.notes ? <p className="mt-3 border-l-2 border-stone-300 pl-3 text-sm leading-6 text-stone-600">{note.notes}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" aria-label="编辑阅读笔记" title="编辑" onClick={() => { setEditingNote(note); setSaveError(''); setEditorOpen(true); }} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-900">✎</button>
                  {note.status !== 'mastered' ? <button type="button" aria-label="标记为已掌握" title="标记为已掌握" onClick={() => void markMastered(note)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-emerald-700 hover:bg-emerald-50">✓</button> : null}
                  <button type="button" aria-label="永久删除" title="永久删除" onClick={() => void deleteNote(note)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-stone-400 hover:bg-red-50 hover:text-red-700">🗑️</button>
                </div>
              </div>
            </li>
          ))}
          {result.items.length === 0 ? <li className="py-14 text-center text-sm text-stone-500">当前筛选下没有阅读笔记</li> : null}
        </ul>
      ) : null}

      <Pagination page={Math.min(page, totalPages)} totalPages={totalPages} onChange={setPage} />

      <Modal open={editorOpen} onClose={() => { if (!saving) setEditorOpen(false); }} title={editingNote ? '编辑阅读笔记' : '新增阅读笔记'} size="lg" compact>
        <ReadingNoteEditor categories={categories} note={editingNote} saving={saving} error={saveError} onSave={(input) => void saveNote(input)} onCancel={() => setEditorOpen(false)} />
      </Modal>

      <Modal open={categoryManagerOpen} onClose={() => setCategoryManagerOpen(false)} title="管理阅读分类" size="lg" compact>
        <ReadingCategoryManager
          categories={categories}
          onChanged={setCategories}
          onMutation={(mutation) => setResult((current) => ({
            ...current,
            items: current.items.map((note) => applyReadingCategoryMutation(note, mutation)),
          }))}
        />
      </Modal>

      {undo ? (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md bg-stone-900 px-4 py-3 text-sm text-white shadow-lg">
          已删除阅读笔记
          <button type="button" onClick={() => void undoDelete()} className="font-medium underline underline-offset-2">撤销</button>
        </div>
      ) : null}
    </section>
  );
}
