// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SectionTabs from '@/components/SectionTabs';
import ListeningKnowledgePointLibrary from '@/components/knowledgePoints/ListeningKnowledgePointLibrary';
import ReadingNoteLibrary from '@/components/readingNotes/ReadingNoteLibrary';
import type { ReadingNote, ReadingNoteCategory } from '@/lib/readingNotes/types';

const categories: ReadingNoteCategory[] = [{
  id: 1,
  name: '固定搭配',
  sortOrder: 0,
  isDefault: false,
  status: 'active',
  noteCount: 1,
}];

const note: ReadingNote = {
  id: 9,
  categoryId: 1,
  categoryName: '固定搭配',
  contentHtml: '<p>be responsible for</p>',
  contentText: 'be responsible for',
  notes: '后接名词或动名词',
  noteDate: '2026-09-03',
  status: 'active',
  correctStreak: 0,
  correctCount: 0,
  wrongCount: 0,
  nextReviewDate: '2026-09-03',
  lastReviewedDate: null,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
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

describe('reading note library workflow', () => {
  it('renders accessible listening and reading tabs without Part labels or internal ids', async () => {
    await act(async () => root.render(
      <SectionTabs
        value="listening"
        options={[
          { value: 'listening', label: '听力笔记' },
          { value: 'reading', label: '阅读笔记' },
        ]}
        onChange={vi.fn()}
      />,
    ));

    const tabs = [...host.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['听力笔记', '阅读笔记']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(host.textContent).not.toMatch(/Part [567]|#\d+/);
  });

  it('shows the approved reading actions and rich note content', async () => {
    await act(async () => root.render(
      <ReadingNoteLibrary
        initialCategories={categories}
        initialPage={{ items: [note], total: 1, page: 1, pageSize: 20 }}
      />,
    ));

    expect([...host.querySelectorAll('button')].map((button) => button.textContent)).toEqual(
      expect.arrayContaining(['新增阅读笔记', '管理分类']),
    );
    expect(host.textContent).toContain('be responsible for');
    expect(host.textContent).toContain('后接名词或动名词');
    expect(host.textContent).not.toMatch(/Part [567]|#\d+/);
    expect(host.querySelector('button[aria-label="编辑阅读笔记"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="标记为已掌握"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="永久删除"]')).toBeTruthy();
  });

  it('removes a mastered note immediately while its write is pending', async () => {
    let resolveWrite!: (response: Response) => void;
    const pendingWrite = new Promise<Response>((resolve) => { resolveWrite = resolve; });
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      if (fetchMock.mock.calls.length === 1) return pendingWrite;
      if (String(url).includes('reading-note-categories')) {
        return Promise.resolve({ ok: true, json: async () => categories } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(
      <ReadingNoteLibrary
        initialCategories={categories}
        initialPage={{ items: [note], total: 1, page: 1, pageSize: 20 }}
      />,
    ));
    const mastered = host.querySelector<HTMLButtonElement>('button[aria-label="标记为已掌握"]');
    if (!mastered) throw new Error('Mastered button not found');

    await act(async () => mastered.click());
    expect(host.textContent).not.toContain('be responsible for');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/reading-notes/9', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'mastered' }),
    });

    await act(async () => {
      resolveWrite({ ok: true, json: async () => ({ ...note, status: 'mastered' }) } as Response);
      await pendingWrite;
    });
  });

  it('keeps the extracted listening library request and key controls unchanged', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: async () => [],
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => root.render(<ListeningKnowledgePointLibrary />));

    expect(fetchMock).toHaveBeenCalledWith('/api/knowledge-points?');
    expect(host.textContent).toContain('手动添加');
    expect(host.querySelector('input[placeholder="搜索词/短语"]')).toBeTruthy();
  });
});
