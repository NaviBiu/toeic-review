// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingCategoryManager from '@/components/readingNotes/ReadingCategoryManager';
import ReadingNoteLibrary, { applyReadingCategoryMutation } from '@/components/readingNotes/ReadingNoteLibrary';
import type { ReadingNote, ReadingNoteCategory } from '@/lib/readingNotes/types';

const category: ReadingNoteCategory = { id: 1, name: '固定搭配', sortOrder: 0, isDefault: false, status: 'active', noteCount: 1 };
const note: ReadingNote = {
  id: 9, categoryId: 1, categoryName: '固定搭配', contentHtml: '<p>as a result</p>',
  contentText: 'as a result', notes: null, noteDate: '2026-09-03', status: 'active',
  correctStreak: 0, correctCount: 0, wrongCount: 0, nextReviewDate: '2026-09-03', lastReviewedDate: null,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reading management performance contracts', () => {
  it('updates mastered state before the write resolves and performs at most one background GET', async () => {
    let resolveWrite!: (value: Response) => void;
    const write = new Promise<Response>((resolve) => { resolveWrite = resolve; });
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') return write;
      if (String(url).startsWith('/api/reading-notes?')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }) } as Response);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<ReadingNoteLibrary initialCategories={[category]} initialPage={{ items: [note], total: 1, page: 1, pageSize: 20 }} />));

    const mastered = host.querySelector<HTMLButtonElement>('button[aria-label="标记为已掌握"]');
    if (!mastered) throw new Error('Mastered button missing');
    await act(async () => mastered.click());
    expect(host.textContent).not.toContain('as a result');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWrite({ ok: true, json: async () => ({ ...note, status: 'mastered' }) } as Response);
      await write;
      await Promise.resolve();
    });
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method);
    const reads = fetchMock.mock.calls.filter(([, init]) => !init?.method);
    expect(writes).toHaveLength(1);
    expect(reads.length).toBeLessThanOrEqual(1);
  });

  it('creates a category with one mutation request and no list reload', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ ...category, id: 2, name: '商务词汇', noteCount: 0 }),
    } as Response));
    const onChanged = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<ReadingCategoryManager categories={[category]} onChanged={onChanged} />));

    const input = host.querySelector<HTMLInputElement>('input[aria-label="新分类名称"]');
    if (!input) throw new Error('Category input missing');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '商务词汇');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const create = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === '新增分类');
    if (!create) throw new Error('Create category button missing');
    await act(async () => create.click());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/reading-note-categories', expect.objectContaining({ method: 'POST' }));
    expect(onChanged).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: '商务词汇' })]));
  });

  it('disables only the category action currently being saved', async () => {
    const pending = new Promise<Response>(() => {});
    vi.stubGlobal('fetch', vi.fn(() => pending));
    await act(async () => root.render(<ReadingCategoryManager categories={[category]} onChanged={vi.fn()} />));

    const input = host.querySelector<HTMLInputElement>('input[aria-label="新分类名称"]');
    if (!input) throw new Error('Category input missing');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '商务词汇');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const create = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === '新增分类') as HTMLButtonElement | undefined;
    if (!create) throw new Error('Create category button missing');
    await act(async () => create.click());

    expect(create.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="重命名分类"]')?.disabled).toBe(false);
  });

  it('rewrites visible note category data locally after rename or merge', () => {
    expect(applyReadingCategoryMutation(note, {
      type: 'rename', sourceId: 1, targetId: 1, targetName: '常用搭配',
    })).toEqual(expect.objectContaining({ categoryId: 1, categoryName: '常用搭配' }));
    expect(applyReadingCategoryMutation(note, {
      type: 'move', sourceId: 1, targetId: 3, targetName: '商务词汇',
    })).toEqual(expect.objectContaining({ categoryId: 3, categoryName: '商务词汇' }));
  });
});
