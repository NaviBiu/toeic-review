'use client';

import { useState } from 'react';
import type { ReadingNote, ReadingNoteCategory } from '@/lib/readingNotes/types';
import { RichReadingEditor } from './RichReadingContent';

function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export type ReadingNoteSaveInput = {
  categoryId: number;
  contentHtml: string;
  notes: string | null;
  noteDate: string;
};

export default function ReadingNoteEditor({
  categories,
  note,
  saving,
  error,
  onSave,
  onCancel,
}: {
  categories: ReadingNoteCategory[];
  note?: ReadingNote | null;
  saving: boolean;
  error?: string;
  onSave: (input: ReadingNoteSaveInput) => void;
  onCancel: () => void;
}) {
  const activeCategories = categories.filter((category) => category.status === 'active');
  const [categoryId, setCategoryId] = useState(note?.categoryId ?? activeCategories[0]?.id ?? 0);
  const [contentHtml, setContentHtml] = useState(note?.contentHtml ?? '');
  const [notes, setNotes] = useState(note?.notes ?? '');
  const [noteDate, setNoteDate] = useState(note?.noteDate ?? todayInShanghai());
  const selectedCategoryId = categoryId || activeCategories[0]?.id || 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onSave({
      categoryId: selectedCategoryId,
      contentHtml,
      notes: notes.trim() || null,
      noteDate,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm font-medium text-stone-800">
        分类
        <select
          value={selectedCategoryId}
          onChange={(event) => setCategoryId(Number(event.target.value))}
          required
          className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
        >
          {activeCategories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-medium text-stone-800">
        知识点
        <span className="mt-1 block text-xs font-normal text-stone-500">可直接粘贴 Word 中的文字和表格</span>
        <div className="mt-2">
          <RichReadingEditor value={contentHtml} onChange={setContentHtml} ariaLabel="知识点" />
        </div>
      </label>

      <label className="block text-sm font-medium text-stone-800">
        备注（可不填）
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          className="mt-1 block w-full resize-y rounded-md border border-stone-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="block text-sm font-medium text-stone-800">
        日期
        <input
          type="date"
          value={noteDate}
          max={todayInShanghai()}
          onChange={(event) => setNoteDate(event.target.value)}
          required
          className="mt-1 block rounded-md border border-stone-300 px-3 py-2 text-sm"
        />
      </label>

      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <div className="flex justify-end gap-3 border-t border-stone-200 pt-4">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-md px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-50">
          取消
        </button>
        <button type="submit" disabled={saving || !selectedCategoryId || !contentHtml} className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:bg-stone-300">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}
