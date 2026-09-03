// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import ReadingCategoryManager from '@/components/readingNotes/ReadingCategoryManager';
import type { ReadingNoteCategory } from '@/lib/readingNotes/types';

const categories: ReadingNoteCategory[] = [
  { id: 1, name: '未分类', sortOrder: 0, isDefault: true, status: 'active', noteCount: 2 },
  { id: 2, name: '固定搭配', sortOrder: 1, isDefault: false, status: 'active', noteCount: 1 },
  { id: 3, name: '商务词汇', sortOrder: 2, isDefault: false, status: 'active', noteCount: 0 },
];

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

describe('reading category manager', () => {
  it('creates a one-level category and keeps the default category protected', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const onChanged = vi.fn();
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
      id: 4, name: '动词 + 名词搭配', sortOrder: 3, isDefault: false, status: 'active', noteCount: 0,
    })));
    vi.stubGlobal('fetch', fetchMock);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;

    await act(async () => root.render(
      <ReadingCategoryManager categories={categories} onChanged={onChanged} />,
    ));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="新分类名称"]');
    if (!input) throw new Error('Category input not found');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '动词 + 名词搭配');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const add = [...host.querySelectorAll('button')].find((button) => button.textContent === '新增分类');
    if (!add) throw new Error('Add category button not found');
    await act(async () => add.click());

    expect(fetchMock).toHaveBeenCalledWith('/api/reading-note-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '动词 + 名词搭配' }),
    });
    expect(onChanged).toHaveBeenCalled();

    const defaultRow = [...host.querySelectorAll('li')]
      .find((row) => row.textContent?.includes('未分类'));
    expect(defaultRow?.querySelector('button[aria-label="删除分类"]')).toBeNull();

    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});
